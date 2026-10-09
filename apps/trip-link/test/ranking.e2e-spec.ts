import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { MemberType } from '../src/libs/enums/member.enum';

jest.setTimeout(120000);
type Row = { _id: string; tourRank?: number; agentRank?: number; agentData?: { agentRank: number } };
type GraphResponse = {
	data?: Record<string, { list: Row[]; metaCounter: Array<{ total: number }> } | Row>;
	errors?: Array<{ extensions: { code: string } }>;
};

describe('Ranking GraphQL contract (disposable MongoDB)', () => {
	let app: INestApplication;
	let connection: Connection;
	const database = `tl_rank_api_${new Types.ObjectId().toHexString()}`;
	const originalMongo = process.env.MONGO_DEV;
	const agentIds = Array.from({ length: 4 }, () => new Types.ObjectId());
	const tourIds = Array.from({ length: 4 }, () => new Types.ObjectId());
	let token: string;
	const agentsQuery = `query Agents($input: AgentsInquiry!) {
		getAgents(input: $input) { list { _id agentRank } metaCounter { total } }
	}`;
	const toursQuery = `query Tours($input: ToursInquiry!) {
		getTours(input: $input) { list { _id tourRank agentData { agentRank } } metaCounter { total } }
	}`;
	const assertDatabase = () => {
		if (connection.name !== database || !/^tl_rank_api_[a-f0-9]{24}$/.test(database))
			throw new Error('Unsafe ranking API fixture database');
	};
	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production' || !originalMongo) throw new Error('Development Mongo URI required');
		const uri = new URL(originalMongo);
		uri.pathname = `/${database}`;
		process.env.MONGO_DEV = uri.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication({ logger: false });
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		connection = app.get<Connection>(getConnectionToken());
		assertDatabase();
		await app.init();
		await connection.collection('members').insertMany(
			agentIds.map((_id, index) => ({
				_id,
				memberNick: `disposable-rank-agent-${index}`,
				memberType: 'AGENT',
				memberStatus: 'ACTIVE',
				...(index > 0 ? { agentRank: index === 3 ? 20 : 10 } : {}),
			})),
		);
		await connection.collection('members').insertMany([
			{ memberNick: 'disposable-rank-blocked', memberType: 'AGENT', memberStatus: 'BLOCK', agentRank: 999 },
			{ memberNick: 'disposable-rank-user', memberType: 'USER', memberStatus: 'ACTIVE', agentRank: 999 },
		]);
		await connection.collection('tours').insertMany(
			tourIds.map((_id, index) => ({
				_id,
				agentId: agentIds[index],
				tourSlug: `disposable-rank-tour-${index}`,
				tourStatus: index === 2 ? 'SOLD_OUT' : 'ACTIVE',
				...(index > 0 ? { tourRank: index === 3 ? 20 : 10 } : {}),
			})),
		);
		await connection.collection('tours').insertOne({
			agentId: agentIds[0],
			tourSlug: 'disposable-rank-draft',
			tourStatus: 'DRAFT',
			tourRank: 999,
		});
		token = await app.get(AuthService).createToken({
			_id: agentIds[0],
			memberType: MemberType.AGENT,
			memberNick: 'disposable-rank-agent-0',
		});
	});
	afterAll(async () => {
		try {
			if (connection) {
				assertDatabase();
				await connection.dropDatabase();
			}
		} finally {
			try {
				await app?.close();
			} finally {
				if (originalMongo === undefined) delete process.env.MONGO_DEV;
				else process.env.MONGO_DEV = originalMongo;
			}
		}
	});
	async function graphql(query: string, variables: Record<string, unknown>, bearer?: string): Promise<GraphResponse> {
		const req = request(app.getHttpServer()).post('/graphql');
		if (bearer) req.set('Authorization', `Bearer ${bearer}`);
		const response = await req.send({ query, variables });
		return response.body as GraphResponse;
	}
	for (const [query, name, field, ids] of [
		[agentsQuery, 'getAgents', 'agentRank', agentIds],
		[toursQuery, 'getTours', 'tourRank', tourIds],
	] as const) {
		it(`${name} ranks ascending and descending with stable ties, pagination and legacy zero`, async () => {
			for (const direction of ['ASC', 'DESC']) {
				const expected = direction === 'ASC' ? ids : [...ids].reverse();
				const combined: Row[] = [];
				for (const page of [1, 2]) {
					const body = await graphql(query, { input: { page, limit: 2, search: {}, sort: field, direction } });
					expect(body.errors).toBeUndefined();
					const result = body.data?.[name] as { list: Row[]; metaCounter: Array<{ total: number }> };
					expect(result.metaCounter).toEqual([{ total: 4 }]);
					combined.push(...result.list);
				}
				expect(combined.map((row) => row._id)).toEqual(expected.map((id) => id.toHexString()));
				expect(combined.map((row) => row[field])).toEqual(direction === 'ASC' ? [0, 10, 10, 20] : [20, 10, 10, 0]);
			}
		});
		it(`${name} rejects unsupported sorts and invalid supplied credentials`, async () => {
			const badSort = await graphql(query, { input: { page: 1, limit: 10, search: {}, sort: 'propertyRank' } });
			expect(badSort.errors?.[0].extensions.code).toBe('BAD_REQUEST');
			const invalidToken = await graphql(query, { input: { page: 1, limit: 10, search: {}, sort: field } }, 'invalid');
			expect(invalidToken.errors?.[0].extensions.code).toBe('UNAUTHENTICATED');
		});
	}
	it('exposes legacy zero on tour detail, joined agent, member profile and current account', async () => {
		const response = await graphql(
			`
				query ($tourId: String!, $memberId: String!) {
					getTour(tourId: $tourId) {
						_id
						tourRank
						agentData {
							agentRank
						}
					}
					getMember(memberId: $memberId) {
						_id
						agentRank
						recentTours {
							tourRank
						}
					}
					getCurrentMember {
						_id
						agentRank
					}
				}
			`,
			{ tourId: tourIds[0].toHexString(), memberId: agentIds[0].toHexString() },
			token,
		);
		expect(response.errors).toBeUndefined();
		expect(response.data?.getTour).toMatchObject({ tourRank: 0, agentData: { agentRank: 0 } });
		expect(response.data?.getMember).toMatchObject({ agentRank: 0 });
		expect(response.data?.getCurrentMember).toMatchObject({ agentRank: 0 });
	});
	it('rejects setting scores through profile and tour mutation inputs', async () => {
		const member = await graphql(
			`
				mutation ($input: MemberUpdate!) {
					updateMember(input: $input) {
						member {
							agentRank
						}
					}
				}
			`,
			{ input: { agentRank: 999 } },
			token,
		);
		expect(member.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
		const tour = await graphql(
			`
				mutation ($input: TourUpdate!) {
					updateTour(input: $input) {
						tourRank
					}
				}
			`,
			{ input: { tourId: tourIds[0].toHexString(), tourRank: 999 } },
			token,
		);
		expect(tour.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
	});
});
