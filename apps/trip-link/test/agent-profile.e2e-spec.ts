import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from './../src/app.module';

jest.setTimeout(30000);

type GraphQLResponse<T> = {
	data?: T | null;
	errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

describe('Public agent reviews (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let originalMongoDev: string | undefined;
	let agentId: string;
	let userId: string;
	let activeTourId: Types.ObjectId;
	let soldOutTourId: Types.ObjectId;

	const reviewsQuery = `query PublicAgentReviews($agentId: String!, $input: PublicAgentReviewsInquiry!) {
		getPublicAgentReviews(agentId: $agentId, input: $input) {
			list { _id reviewRating reviewStatus userData { _id } tourData { _id tourStatus } }
			metaCounter { total }
		}
	}`;

	beforeAll(async () => {
		originalMongoDev = process.env.MONGO_DEV;
		if (!originalMongoDev) throw new Error('MONGO_DEV is required for agent profile e2e tests');

		const mongoUrl = new URL(originalMongoDev);
		mongoUrl.pathname = `/tl_agent_e2e_${Date.now()}`;
		process.env.MONGO_DEV = mongoUrl.toString();

		const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = moduleFixture.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.init();
		connection = app.get<Connection>(getConnectionToken());

		const suffix = new Types.ObjectId().toHexString().slice(-8);
		agentId = await signup(`agent-${suffix}`, `agent-${suffix}@example.com`, 'AGENT');
		userId = await signup(`user-${suffix}`, `user-${suffix}@example.com`, 'USER');
		activeTourId = new Types.ObjectId();
		soldOutTourId = new Types.ObjectId();
		const draftTourId = new Types.ObjectId();
		await connection.collection('tours').insertMany([
			{ _id: activeTourId, agentId: new Types.ObjectId(agentId), tourStatus: 'ACTIVE', tourSlug: `active-${suffix}` },
			{ _id: soldOutTourId, agentId: new Types.ObjectId(agentId), tourStatus: 'SOLD_OUT', tourSlug: `sold-${suffix}` },
			{ _id: draftTourId, agentId: new Types.ObjectId(agentId), tourStatus: 'DRAFT', tourSlug: `draft-${suffix}` },
		]);
		await connection
			.collection('reviews')
			.insertMany([
				review(activeTourId, 'ACTIVE', 5, new Date('2026-01-01')),
				review(activeTourId, 'ACTIVE', 4, new Date('2026-01-02')),
				review(soldOutTourId, 'ACTIVE', 3, new Date('2026-01-03')),
				review(activeTourId, 'HIDDEN', 1, new Date('2026-01-04')),
				review(draftTourId, 'ACTIVE', 2, new Date('2026-01-05')),
			]);
	});

	afterAll(async () => {
		try {
			if (connection) await connection.dropDatabase();
		} finally {
			if (app) await app.close();
			if (originalMongoDev) process.env.MONGO_DEV = originalMongoDev;
			else delete process.env.MONGO_DEV;
		}
	});

	it('lists only active reviews of public tours with pagination and filters', async () => {
		const pageOne = await graphqlRequest<{
			getPublicAgentReviews: {
				list: Array<{ reviewRating: number; tourData: { _id: string }; userData: { _id: string } }>;
				metaCounter: Array<{ total: number }>;
			};
		}>(reviewsQuery, { agentId, input: { page: 1, limit: 2, search: {} } });
		expect(pageOne.errors).toBeUndefined();
		expect(pageOne.data?.getPublicAgentReviews.metaCounter).toEqual([{ total: 3 }]);
		expect(pageOne.data?.getPublicAgentReviews.list.map((item) => item.reviewRating)).toEqual([3, 4]);
		expect(pageOne.data?.getPublicAgentReviews.list[0].tourData._id).toBe(soldOutTourId.toHexString());
		expect(pageOne.data?.getPublicAgentReviews.list[0].userData._id).toBe(userId);

		const pageTwo = await graphqlRequest<{
			getPublicAgentReviews: { list: Array<{ reviewRating: number }>; metaCounter: Array<{ total: number }> };
		}>(reviewsQuery, { agentId, input: { page: 2, limit: 2, search: {} } });
		expect(pageTwo.data?.getPublicAgentReviews.list.map((item) => item.reviewRating)).toEqual([5]);
		expect(pageTwo.data?.getPublicAgentReviews.metaCounter).toEqual([{ total: 3 }]);

		const filtered = await graphqlRequest<{
			getPublicAgentReviews: { list: Array<{ reviewRating: number }>; metaCounter: Array<{ total: number }> };
		}>(reviewsQuery, {
			agentId,
			input: { page: 1, limit: 10, search: { reviewRating: 5, tourId: activeTourId.toHexString() } },
		});
		expect(filtered.data?.getPublicAgentReviews.list.map((item) => item.reviewRating)).toEqual([5]);
		expect(filtered.data?.getPublicAgentReviews.metaCounter).toEqual([{ total: 1 }]);
	});

	it('rejects a non-agent target and invalid agent ID', async () => {
		const nonAgent = await graphqlRequest(reviewsQuery, {
			agentId: userId,
			input: { page: 1, limit: 10, search: {} },
		});
		expect(nonAgent.errors?.[0].extensions?.code).toBe('INTERNAL_SERVER_ERROR');

		const invalid = await graphqlRequest(reviewsQuery, {
			agentId: 'invalid',
			input: { page: 1, limit: 10, search: {} },
		});
		expect(invalid.errors?.[0].extensions?.code).toBe('BAD_REQUEST');
	});

	function review(tourId: Types.ObjectId, reviewStatus: string, reviewRating: number, createdAt: Date) {
		return {
			bookingId: new Types.ObjectId(),
			userId: new Types.ObjectId(userId),
			agentId: new Types.ObjectId(agentId),
			tourId,
			reviewStatus,
			reviewRating,
			reviewComment: 'A useful review',
			createdAt,
			updatedAt: createdAt,
		};
	}

	async function signup(memberNick: string, memberEmail: string, memberType: string): Promise<string> {
		const response = await graphqlRequest<{ signup: { member: { _id: string } } }>(
			`mutation Signup($input: MemberInput!) { signup(input: $input) { member { _id } } }`,
			{ input: { memberNick, memberEmail, memberPassword: 'TestPass123!', memberType } },
		);
		if (!response.data?.signup) throw new Error(response.errors?.[0].message ?? 'Signup failed');
		return response.data.signup.member._id;
	}

	async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<GraphQLResponse<T>> {
		const response = await request(app.getHttpServer()).post('/graphql').send({ query, variables }).expect(200);
		return JSON.parse(response.text) as GraphQLResponse<T>;
	}
});
