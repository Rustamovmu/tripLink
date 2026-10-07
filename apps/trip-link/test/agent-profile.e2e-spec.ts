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
	const originalMongoDev = process.env.MONGO_DEV;
	const testDatabase = `tl_agent_e2e_${new Types.ObjectId().toHexString()}`;
	const assertDatabase = () => {
		if (connection.name !== testDatabase || !/^tl_agent_e2e_[a-f0-9]{24}$/.test(testDatabase))
			throw new Error('Unexpected profile-test database');
	};
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
	const profileQuery = `query MemberProfile($memberId: String!) {
		getMember(memberId: $memberId) {
			_id agentAverageRating agentReviewCount agentTourCount recentTours { _id }
		}
	}`;
	type ProfileResponse = {
		getMember: {
			agentAverageRating: number | null;
			agentReviewCount: number | null;
			agentTourCount: number | null;
			recentTours: Array<{ _id: string }>;
		};
	};

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Profile tests cannot run in production');
		if (!originalMongoDev) throw new Error('MONGO_DEV is required for agent profile e2e tests');

		const mongoUrl = new URL(originalMongoDev);
		mongoUrl.pathname = `/${testDatabase}`;
		process.env.MONGO_DEV = mongoUrl.toString();

		const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = moduleFixture.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		connection = app.get<Connection>(getConnectionToken());
		assertDatabase();
		await app.init();

		const suffix = new Types.ObjectId().toHexString().slice(-8);
		agentId = await signup(`agent-${suffix}`, `agent-${suffix}@example.com`, 'AGENT');
		userId = await signup(`user-${suffix}`, `user-${suffix}@example.com`, 'USER');
		activeTourId = new Types.ObjectId();
		soldOutTourId = new Types.ObjectId();
		const draftTourId = new Types.ObjectId();
		const otherOwnerTourId = new Types.ObjectId();
		await connection.collection('tours').insertMany([
			{ _id: activeTourId, agentId: new Types.ObjectId(agentId), tourStatus: 'ACTIVE', tourSlug: `active-${suffix}` },
			{ _id: soldOutTourId, agentId: new Types.ObjectId(agentId), tourStatus: 'SOLD_OUT', tourSlug: `sold-${suffix}` },
			{ _id: draftTourId, agentId: new Types.ObjectId(agentId), tourStatus: 'DRAFT', tourSlug: `draft-${suffix}` },
			{ _id: otherOwnerTourId, agentId: new Types.ObjectId(), tourStatus: 'ACTIVE', tourSlug: `other-${suffix}` },
		]);
		await connection
			.collection('reviews')
			.insertMany([
				review(activeTourId, 'ACTIVE', 5, new Date('2026-01-01')),
				review(activeTourId, 'ACTIVE', 4, new Date('2026-01-02')),
				review(soldOutTourId, 'ACTIVE', 3, new Date('2026-01-03')),
				review(activeTourId, 'HIDDEN', 1, new Date('2026-01-04')),
				review(draftTourId, 'ACTIVE', 2, new Date('2026-01-05')),
				review(activeTourId, 'DELETE', 1, new Date('2026-01-06')),
				review(new Types.ObjectId(), 'ACTIVE', 1, new Date('2026-01-07')),
				review(otherOwnerTourId, 'ACTIVE', 1, new Date('2026-01-08')),
			]);
	});

	afterAll(async () => {
		try {
			if (connection) {
				assertDatabase();
				await connection.dropDatabase();
			}
		} finally {
			try {
				if (app) await app.close();
			} finally {
				if (originalMongoDev === undefined) delete process.env.MONGO_DEV;
				else process.env.MONGO_DEV = originalMongoDev;
			}
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

	it('matches profile rating and count to the unfiltered public review list', async () => {
		const profile = await graphqlRequest<ProfileResponse>(profileQuery, { memberId: agentId });
		const reviews = await graphqlRequest<{
			getPublicAgentReviews: { list: Array<{ reviewRating: number }>; metaCounter: Array<{ total: number }> };
		}>(reviewsQuery, { agentId, input: { page: 1, limit: 10, search: {} } });
		expect(profile.errors).toBeUndefined();
		expect(reviews.errors).toBeUndefined();
		expect(profile.data?.getMember.agentReviewCount).toBe(3);
		expect(profile.data?.getMember.agentReviewCount).toBe(reviews.data?.getPublicAgentReviews.metaCounter[0].total);
		const ratings = reviews.data!.getPublicAgentReviews.list.map((item) => item.reviewRating);
		expect(profile.data?.getMember.agentAverageRating).toBe(
			ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
		);
		expect(profile.data?.getMember.agentAverageRating).toBe(4);
		expect(profile.data?.getMember.agentTourCount).toBe(2);
		expect(profile.data?.getMember.recentTours.map((tour) => tour._id).sort()).toEqual(
			[activeTourId.toHexString(), soldOutTourId.toHexString()].sort(),
		);
	});

	it('returns zero rating and count when the agent has no public tours', async () => {
		const tourIds = [activeTourId, soldOutTourId];
		try {
			await connection.collection('tours').updateMany({ _id: { $in: tourIds } }, { $set: { tourStatus: 'DRAFT' } });
			const profile = await graphqlRequest<ProfileResponse>(profileQuery, { memberId: agentId });
			expect(profile.errors).toBeUndefined();
			expect(profile.data?.getMember).toMatchObject({
				agentAverageRating: 0,
				agentReviewCount: 0,
				agentTourCount: 0,
				recentTours: [],
			});
		} finally {
			await connection.collection('tours').updateOne({ _id: activeTourId }, { $set: { tourStatus: 'ACTIVE' } });
			await connection.collection('tours').updateOne({ _id: soldOutTourId }, { $set: { tourStatus: 'SOLD_OUT' } });
		}
	});

	it('keeps agent-specific statistics absent from regular user profiles', async () => {
		const profile = await graphqlRequest<ProfileResponse>(profileQuery, { memberId: userId });
		expect(profile.errors).toBeUndefined();
		expect(profile.data?.getMember).toMatchObject({
			agentAverageRating: null,
			agentReviewCount: null,
			agentTourCount: null,
			recentTours: [],
		});
	});

	it('rejects a non-agent target and invalid agent ID', async () => {
		const nonAgent = await graphqlRequest(reviewsQuery, {
			agentId: userId,
			input: { page: 1, limit: 10, search: {} },
		});
		expect(nonAgent.errors?.[0].extensions?.code).toBe('NOT_FOUND');

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
