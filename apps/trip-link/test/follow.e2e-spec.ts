import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/components/auth/auth.service';
import { MemberType } from './../src/libs/enums/member.enum';

jest.setTimeout(30000);

type GraphQLError = {
	message: string;
	extensions?: { code?: string };
};

type GraphQLResponse<T> = {
	data?: T | null;
	errors?: GraphQLError[];
};

type AuthMember = {
	_id: string;
	memberType: MemberType;
};

type AuthPayload = {
	accessToken: string;
	member: AuthMember;
};

describe('Follow GraphQL API (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let originalMongoDev: string | undefined;
	let user: AuthMember;
	let userToken: string;
	let agent: AuthMember;
	let agentToken: string;
	let adminToken: string;

	const toggleMutation = `
		mutation ToggleFollowMember($memberId: String!) {
			toggleFollowMember(memberId: $memberId) {
				followed
				member {
					_id
					memberFollowers
					memberFollowings
				}
			}
		}
	`;

	beforeAll(async () => {
		originalMongoDev = process.env.MONGO_DEV;
		if (!originalMongoDev) throw new Error('MONGO_DEV is required for Follow e2e tests');

		const mongoUrl = new URL(originalMongoDev);
		mongoUrl.pathname = `/trip_link_follow_e2e_${Date.now()}`;
		process.env.MONGO_DEV = mongoUrl.toString();

		const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = moduleFixture.createNestApplication();
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			}),
		);
		await app.init();

		connection = app.get<Connection>(getConnectionToken());
		const suffix = new Types.ObjectId().toHexString().slice(-8);
		const userAuth = await signup(`user-${suffix}`, `user-${suffix}@example.com`, MemberType.USER);
		const agentAuth = await signup(`agent-${suffix}`, `agent-${suffix}@example.com`, MemberType.AGENT);
		user = userAuth.member;
		userToken = userAuth.accessToken;
		agent = agentAuth.member;
		agentToken = agentAuth.accessToken;

		const authService = app.get(AuthService);
		adminToken = await authService.createToken({
			_id: new Types.ObjectId().toHexString(),
			memberType: MemberType.ADMIN,
			memberNick: `admin-${suffix}`,
		});
	});

	afterAll(async () => {
		if (connection) await connection.dropDatabase();
		if (app) await app.close();
		if (originalMongoDev) process.env.MONGO_DEV = originalMongoDev;
		else delete process.env.MONGO_DEV;
	});

	it('enforces authentication, role access, and self-follow prevention', async () => {
		const unauthenticated = await graphqlRequest<{ toggleFollowMember: unknown }>(toggleMutation, {
			memberId: agent._id,
		});
		expect(unauthenticated.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');

		const forbidden = await graphqlRequest<{ toggleFollowMember: unknown }>(
			toggleMutation,
			{ memberId: agent._id },
			adminToken,
		);
		expect(forbidden.errors?.[0].extensions?.code).toBe('FORBIDDEN');

		const selfFollow = await graphqlRequest<{ toggleFollowMember: unknown }>(
			toggleMutation,
			{ memberId: user._id },
			userToken,
		);
		expect(selfFollow.errors?.[0].extensions?.code).toBe('BAD_REQUEST');
	});

	it('uses the same public profile shape for users and agents', async () => {
		type Profile = {
			_id: string;
			memberType: MemberType;
			isFollowing: boolean;
			agentAverageRating: number | null;
			agentReviewCount: number | null;
			agentTourCount: number | null;
			recentTours: Array<{ _id: string }>;
		};
		const profileQuery = `query GetMember($memberId: String!) {
			getMember(memberId: $memberId) {
				_id memberType isFollowing
				agentAverageRating agentReviewCount agentTourCount
				recentTours { _id }
			}
		}`;

		const userProfile = await graphqlRequest<{ getMember: Profile }>(profileQuery, { memberId: user._id });
		expect(userProfile.errors).toBeUndefined();
		expect(userProfile.data?.getMember).toMatchObject({
			_id: user._id,
			memberType: MemberType.USER,
			isFollowing: false,
			agentAverageRating: null,
			agentReviewCount: null,
			agentTourCount: null,
			recentTours: [],
		});

		const agentProfile = await graphqlRequest<{ getMember: Profile }>(profileQuery, { memberId: agent._id }, userToken);
		expect(agentProfile.errors).toBeUndefined();
		expect(agentProfile.data?.getMember).toMatchObject({
			_id: agent._id,
			memberType: MemberType.AGENT,
			isFollowing: false,
			agentAverageRating: 0,
			agentReviewCount: 0,
			agentTourCount: 0,
			recentTours: [],
		});

		await connection.collection('tours').insertMany([
			{
				agentId: new Types.ObjectId(agent._id),
				tourSlug: 'profile-active',
				tourStatus: 'ACTIVE',
				createdAt: new Date('2026-01-01'),
			},
			{
				agentId: new Types.ObjectId(agent._id),
				tourSlug: 'profile-sold-out',
				tourStatus: 'SOLD_OUT',
				createdAt: new Date('2026-01-02'),
			},
			{
				agentId: new Types.ObjectId(agent._id),
				tourSlug: 'profile-draft',
				tourStatus: 'DRAFT',
				createdAt: new Date('2026-01-03'),
			},
		]);
		await connection.collection('reviews').insertMany([
			{
				agentId: new Types.ObjectId(agent._id),
				bookingId: new Types.ObjectId(),
				reviewStatus: 'ACTIVE',
				reviewRating: 4,
			},
			{
				agentId: new Types.ObjectId(agent._id),
				bookingId: new Types.ObjectId(),
				reviewStatus: 'ACTIVE',
				reviewRating: 5,
			},
			{
				agentId: new Types.ObjectId(agent._id),
				bookingId: new Types.ObjectId(),
				reviewStatus: 'HIDDEN',
				reviewRating: 1,
			},
		]);

		const populatedAgentProfile = await graphqlRequest<{ getMember: Profile }>(
			profileQuery,
			{ memberId: agent._id },
			userToken,
		);
		expect(populatedAgentProfile.errors).toBeUndefined();
		expect(populatedAgentProfile.data?.getMember).toMatchObject({
			agentAverageRating: 4.5,
			agentReviewCount: 2,
			agentTourCount: 2,
		});
		expect(populatedAgentProfile.data?.getMember.recentTours).toHaveLength(2);
	});

	it('supports USER and AGENT follows, relationship state, and paginated lists', async () => {
		const userFollowsAgent = await graphqlRequest<{
			toggleFollowMember: { followed: boolean; member: { memberFollowers: number } };
		}>(toggleMutation, { memberId: agent._id }, userToken);
		expect(userFollowsAgent.errors).toBeUndefined();
		expect(userFollowsAgent.data?.toggleFollowMember).toMatchObject({
			followed: true,
			member: { memberFollowers: 1 },
		});
		const followedProfile = await graphqlRequest<{ getMember: { isFollowing: boolean } }>(
			`query GetMember($memberId: String!) { getMember(memberId: $memberId) { isFollowing } }`,
			{ memberId: agent._id },
			userToken,
		);
		expect(followedProfile.data?.getMember.isFollowing).toBe(true);

		const agentFollowsUser = await graphqlRequest<{
			toggleFollowMember: { followed: boolean; member: { memberFollowers: number } };
		}>(toggleMutation, { memberId: user._id }, agentToken);
		expect(agentFollowsUser.errors).toBeUndefined();
		expect(agentFollowsUser.data?.toggleFollowMember).toMatchObject({
			followed: true,
			member: { memberFollowers: 1 },
		});

		const agents = await graphqlRequest<{
			getAgents: { list: Array<{ _id: string; isFollowing: boolean }>; metaCounter: Array<{ total: number }> };
		}>(
			`query GetAgents($input: AgentsInquiry!) {
				getAgents(input: $input) {
					list { _id isFollowing }
					metaCounter { total }
				}
			}`,
			{ input: { page: 1, limit: 10, search: {} } },
			userToken,
		);
		expect(agents.data?.getAgents.list).toContainEqual({ _id: agent._id, isFollowing: true });
		expect(agents.data?.getAgents.metaCounter).toEqual([{ total: 1 }]);

		const followers = await graphqlRequest<{
			getMemberFollowers: {
				list: Array<{ followerId: string; isFollowing: boolean; memberData: { _id: string } }>;
				metaCounter: Array<{ total: number }>;
			};
		}>(
			`query GetMemberFollowers($input: FollowInquiry!) {
				getMemberFollowers(input: $input) {
					list { followerId isFollowing memberData { _id } }
					metaCounter { total }
				}
			}`,
			{ input: { page: 1, limit: 1, search: { memberId: agent._id } } },
			agentToken,
		);
		expect(followers.data?.getMemberFollowers.list).toEqual([
			{ followerId: user._id, isFollowing: true, memberData: { _id: user._id } },
		]);
		expect(followers.data?.getMemberFollowers.metaCounter).toEqual([{ total: 1 }]);

		const followings = await graphqlRequest<{
			getMemberFollowings: {
				list: Array<{ followingId: string; isFollowing: boolean; memberData: { _id: string } }>;
				metaCounter: Array<{ total: number }>;
			};
		}>(
			`query GetMemberFollowings($input: FollowInquiry!) {
				getMemberFollowings(input: $input) {
					list { followingId isFollowing memberData { _id } }
					metaCounter { total }
				}
			}`,
			{ input: { page: 1, limit: 1, search: { memberId: user._id } } },
			userToken,
		);
		expect(followings.data?.getMemberFollowings.list).toEqual([
			{ followingId: agent._id, isFollowing: true, memberData: { _id: agent._id } },
		]);
		expect(followings.data?.getMemberFollowings.metaCounter).toEqual([{ total: 1 }]);

		const unfollow = await graphqlRequest<{
			toggleFollowMember: { followed: boolean; member: { memberFollowers: number } };
		}>(toggleMutation, { memberId: agent._id }, userToken);
		expect(unfollow.data?.toggleFollowMember).toMatchObject({
			followed: false,
			member: { memberFollowers: 0 },
		});
	});

	async function signup(memberNick: string, memberEmail: string, memberType: MemberType): Promise<AuthPayload> {
		const response = await graphqlRequest<{ signup: AuthPayload }>(
			`mutation Signup($input: MemberInput!) {
				signup(input: $input) {
					accessToken
					member { _id memberType }
				}
			}`,
			{
				input: {
					memberNick,
					memberEmail,
					memberPassword: 'TestPass123!',
					memberType,
				},
			},
		);
		if (!response.data?.signup) throw new Error(response.errors?.[0].message ?? 'Signup failed');
		return response.data.signup;
	}

	async function graphqlRequest<T>(
		query: string,
		variables: Record<string, unknown>,
		accessToken?: string,
	): Promise<GraphQLResponse<T>> {
		let operation = request(app.getHttpServer()).post('/graphql').send({ query, variables });
		if (accessToken) operation = operation.set('Authorization', `Bearer ${accessToken}`);
		const response = await operation.expect(200);
		const parsed: unknown = JSON.parse(response.text);
		return parsed as GraphQLResponse<T>;
	}
});
