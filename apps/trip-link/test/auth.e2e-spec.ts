import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';

jest.setTimeout(30000);

type Actor = { id: string; nick: string; token: string };
type Result<T> = { data?: T | null; errors?: Array<{ message: string; extensions?: { code?: string } }> };
type LoginResult = { accessToken: string; member: { _id: string } };
type CurrentMemberResult = {
	getCurrentMember: {
		_id: string;
		memberType: MemberType;
		memberStatus: MemberStatus;
		memberNick: string;
		memberFullname: string | null;
		memberImage: string;
		memberCountry: string | null;
		memberDesc: string | null;
		memberFavoriteDestinations: string[];
		memberViews: number;
	};
};

// Every account and counter in this suite belongs to its disposable tl_auth_e2e_* database.
describe('Current-account authorization (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let testDatabase: string;
	let originalMongoDev: string | undefined;
	let user: Actor;
	let agent: Actor;
	let admin: Actor;
	let controller: Actor;
	const password = 'TestPass123!';
	const checkQuery = 'query { checkAuth }';
	const adminQuery = 'query Members($input: MembersInquiry!) { getAllMembersByAdmin(input: $input) { list { _id } } }';
	const profileQuery = 'query Profile($memberId: String!) { getMember(memberId: $memberId) { _id } }';
	const currentMemberQuery = `query GetCurrentMember {
		getCurrentMember {
			_id memberType memberStatus memberNick memberFullname memberImage memberCountry
			memberDesc memberFavoriteDestinations memberViews
		}
	}`;
	const assertDatabase = () => {
		if (connection.name !== testDatabase || !/^tl_auth_e2e_[a-f0-9]{24}$/.test(testDatabase))
			throw new Error('Unexpected auth-test database');
	};

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Auth tests cannot run in production');
		originalMongoDev = process.env.MONGO_DEV;
		if (!originalMongoDev) throw new Error('MONGO_DEV is required for auth e2e tests');
		testDatabase = `tl_auth_e2e_${new Types.ObjectId().toHexString()}`;
		const url = new URL(originalMongoDev);
		url.pathname = `/${testDatabase}`;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		connection = app.get<Connection>(getConnectionToken());
		assertDatabase();
		await app.init();
		user = await signup(MemberType.USER);
		agent = await signup(MemberType.AGENT);
		admin = await signup(MemberType.ADMIN);
		controller = await signup(MemberType.ADMIN);
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

	it.each(Object.values(MemberType))('returns the authenticated ACTIVE %s account', async (role) => {
		const actor = role === MemberType.ADMIN ? admin : role === MemberType.AGENT ? agent : user;
		const result = await graphql<CurrentMemberResult>(currentMemberQuery, {}, actor.token);
		expect(result.errors).toBeUndefined();
		expect(result.data?.getCurrentMember).toMatchObject({
			_id: actor.id,
			memberType: role,
			memberStatus: MemberStatus.ACTIVE,
			memberNick: actor.nick,
		});
	});

	it('rejects missing, invalid and incorrectly signed current-account tokens', async () => {
		const forged = await new JwtService({ secret: 'different-test-secret' }).signAsync({
			sub: user.id,
			memberType: MemberType.USER,
			memberNick: user.nick,
		});
		for (const token of [undefined, 'invalid', forged]) {
			const result = await graphql(currentMemberQuery, {}, token);
			expect(result.data).toBeNull();
			expect(result.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		}
	});

	it.each(['memberPassword', 'memberEmail', 'memberPhone', 'memberAddress', 'memberAuthType', 'accessToken'])(
		'keeps %s outside the current-account GraphQL type',
		async (field) => {
			const response = await request(app.getHttpServer())
				.post('/graphql')
				.set('Authorization', `Bearer ${user.token}`)
				.send({ query: `query { getCurrentMember { _id ${field} } }`, variables: {} })
				.expect(400);
			const result = JSON.parse(response.text) as Result<unknown>;
			expect(result.data).toBeUndefined();
			expect(result.errors?.[0].extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
		},
	);

	it('rejects a client-supplied member ID on the current-account query', async () => {
		const response = await request(app.getHttpServer())
			.post('/graphql')
			.set('Authorization', `Bearer ${user.token}`)
			.send({
				query: 'query Current($memberId: String!) { getCurrentMember(memberId: $memberId) { _id } }',
				variables: { memberId: agent.id },
			})
			.expect(400);
		const result = JSON.parse(response.text) as Result<unknown>;
		expect(result.data).toBeUndefined();
		expect(result.errors?.[0].extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
	});

	it('keeps ADMIN accounts excluded from public profiles', async () => {
		for (const token of [undefined, admin.token, user.token]) {
			const result = await graphql(profileQuery, { memberId: admin.id }, token);
			expect(result.data).toBeNull();
			expect(result.errors?.[0].extensions?.code).toBe('NOT_FOUND');
		}
	});

	it('reads current profile fields without changing records or interaction counters', async () => {
		const actor = await signup(MemberType.USER);
		const profile = {
			memberNick: `fresh-${new Types.ObjectId().toHexString().slice(-8)}`,
			memberFullname: 'Disposable traveler',
			memberImage: '',
			memberCountry: 'South Korea',
			memberDesc: '[DISPOSABLE TEST] Updated profile',
			memberFavoriteDestinations: ['Seoul'],
		};
		expect((await manage(actor.id, profile)).errors).toBeUndefined();
		const before = await connection.collection('members').findOne({ _id: new Types.ObjectId(actor.id) });
		const viewsBefore = await connection.collection('views').find({}).toArray();
		const followsBefore = await connection.collection('follows').find({}).toArray();
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await graphql<CurrentMemberResult>(currentMemberQuery, {}, actor.token);
			expect(result.errors).toBeUndefined();
			expect(result.data?.getCurrentMember).toMatchObject({ _id: actor.id, ...profile });
		}
		expect(await connection.collection('members').findOne({ _id: new Types.ObjectId(actor.id) })).toEqual(before);
		expect(await connection.collection('views').find({}).toArray()).toEqual(viewsBefore);
		expect(await connection.collection('follows').find({}).toArray()).toEqual(followsBefore);
	});

	it('permits active admins and denies USER/AGENT access to admin operations', async () => {
		expect((await listMembers(admin.token)).errors).toBeUndefined();
		for (const actor of [user, agent])
			expect((await listMembers(actor.token)).errors?.[0].extensions?.code).toBe('FORBIDDEN');
	});

	it('checks every role against current account status and re-enables restored tokens', async () => {
		for (const actor of [user, agent, admin]) {
			for (const status of [MemberStatus.PENDING, MemberStatus.BLOCK, MemberStatus.SUSPENDED, MemberStatus.DELETE]) {
				expect((await manage(actor.id, { memberStatus: status })).errors).toBeUndefined();
				expect((await graphql(checkQuery, {}, actor.token)).errors?.[0].extensions?.code).toBe(
					status === MemberStatus.DELETE ? 'UNAUTHENTICATED' : 'FORBIDDEN',
				);
				const currentMember = await graphql(currentMemberQuery, {}, actor.token);
				expect(currentMember.data).toBeNull();
				expect(currentMember.errors?.[0].extensions?.code).toBe(
					status === MemberStatus.DELETE ? 'UNAUTHENTICATED' : 'FORBIDDEN',
				);
				if (actor === admin)
					expect((await listMembers(actor.token)).errors?.[0].extensions?.code).toBe(
						status === MemberStatus.DELETE ? 'UNAUTHENTICATED' : 'FORBIDDEN',
					);
				expect((await manage(actor.id, { memberStatus: MemberStatus.ACTIVE })).errors).toBeUndefined();
				expect((await graphql(checkQuery, {}, actor.token)).errors).toBeUndefined();
				expect((await graphql(currentMemberQuery, {}, actor.token)).errors).toBeUndefined();
			}
		}
	});

	it('requires a fresh login after promotion or demotion and honors reverted matching roles', async () => {
		const promoted = await signup(MemberType.USER);
		expect((await manage(promoted.id, { memberType: MemberType.ADMIN })).errors).toBeUndefined();
		expect((await listMembers(promoted.token)).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		expect((await graphql(currentMemberQuery, {}, promoted.token)).errors?.[0].extensions?.code).toBe(
			'UNAUTHENTICATED',
		);
		const promotedToken = await login(promoted.nick);
		expect((await listMembers(promotedToken)).errors).toBeUndefined();
		expect(
			(await graphql<CurrentMemberResult>(currentMemberQuery, {}, promotedToken)).data?.getCurrentMember,
		).toMatchObject({
			_id: promoted.id,
			memberType: MemberType.ADMIN,
		});
		expect((await manage(promoted.id, { memberType: MemberType.USER })).errors).toBeUndefined();
		expect((await listMembers(promotedToken)).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		expect((await graphql(currentMemberQuery, {}, promotedToken)).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		const demotedToken = await login(promoted.nick);
		expect((await listMembers(demotedToken)).errors?.[0].extensions?.code).toBe('FORBIDDEN');
		expect(
			(await graphql<CurrentMemberResult>(currentMemberQuery, {}, demotedToken)).data?.getCurrentMember,
		).toMatchObject({
			_id: promoted.id,
			memberType: MemberType.USER,
		});
		expect((await graphql(checkQuery, {}, promoted.token)).errors).toBeUndefined();
	});

	it('keeps public queries anonymous without a token and validates supplied tokens', async () => {
		expect((await graphql(profileQuery, { memberId: agent.id })).errors).toBeUndefined();
		expect((await graphql(profileQuery, { memberId: agent.id }, 'invalid')).errors?.[0].extensions?.code).toBe(
			'UNAUTHENTICATED',
		);
		expect((await manage(user.id, { memberStatus: MemberStatus.BLOCK })).errors).toBeUndefined();
		try {
			expect((await graphql(profileQuery, { memberId: agent.id }, user.token)).errors?.[0].extensions?.code).toBe(
				'FORBIDDEN',
			);
		} finally {
			expect((await manage(user.id, { memberStatus: MemberStatus.ACTIVE })).errors).toBeUndefined();
		}
	});

	it('rejects deleted database members and expired tokens', async () => {
		const removed = await signup(MemberType.USER);
		await connection.collection('members').deleteOne({ _id: new Types.ObjectId(removed.id) });
		expect((await graphql(checkQuery, {}, removed.token)).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		expect((await graphql(currentMemberQuery, {}, removed.token)).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		const expired = await app
			.get(JwtService)
			.signAsync({ sub: user.id, memberType: MemberType.USER, memberNick: user.nick }, { expiresIn: -1 });
		expect((await graphql(checkQuery, {}, expired)).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		expect((await graphql(currentMemberQuery, {}, expired)).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
	});

	it('uses the current nickname with an existing token', async () => {
		const renamed = await signup(MemberType.USER);
		expect(
			(await manage(renamed.id, { memberNick: `new-${new Types.ObjectId().toHexString().slice(-8)}` })).errors,
		).toBeUndefined();
		const current = await connection.collection('members').findOne({ _id: new Types.ObjectId(renamed.id) });
		expect((await graphql<{ checkAuth: string }>(checkQuery, {}, renamed.token)).data?.checkAuth).toBe(
			`Hi ${String(current?.memberNick)}`,
		);
	});

	it('rejects disabled-member mutations without changing target records or counters', async () => {
		expect((await manage(user.id, { memberStatus: MemberStatus.BLOCK })).errors).toBeUndefined();
		expect((await manage(admin.id, { memberStatus: MemberStatus.SUSPENDED })).errors).toBeUndefined();
		try {
			const before = await connection
				.collection('members')
				.find({ _id: { $in: [new Types.ObjectId(user.id), new Types.ObjectId(agent.id)] } })
				.toArray();
			const followCount = await connection.collection('follows').countDocuments();
			const follow = await graphql(
				'mutation Follow($memberId: String!) { toggleFollowMember(memberId: $memberId) { followed } }',
				{ memberId: agent.id },
				user.token,
			);
			expect(follow.errors?.[0].extensions?.code).toBe('FORBIDDEN');
			expect(
				(await manage(agent.id, { memberStatus: MemberStatus.DELETE }, admin.token)).errors?.[0].extensions?.code,
			).toBe('FORBIDDEN');
			expect(
				await connection
					.collection('members')
					.find({ _id: { $in: [new Types.ObjectId(user.id), new Types.ObjectId(agent.id)] } })
					.toArray(),
			).toEqual(before);
			expect(await connection.collection('follows').countDocuments()).toBe(followCount);
		} finally {
			expect((await manage(user.id, { memberStatus: MemberStatus.ACTIVE })).errors).toBeUndefined();
			expect((await manage(admin.id, { memberStatus: MemberStatus.ACTIVE })).errors).toBeUndefined();
		}
	});

	async function signup(role: MemberType): Promise<Actor> {
		const nick = `${role.toLowerCase()}-${new Types.ObjectId().toHexString().slice(-8)}`;
		const result = await graphql<{ signup: LoginResult }>(
			'mutation Signup($input: MemberInput!) { signup(input: $input) { accessToken member { _id } } }',
			{
				input: {
					memberNick: nick,
					memberEmail: `${nick}@example.com`,
					memberPassword: password,
					memberType: role === MemberType.ADMIN ? MemberType.USER : role,
				},
			},
		);
		expect(result.errors).toBeUndefined();
		const actor = { id: result.data!.signup.member._id, nick, token: result.data!.signup.accessToken };
		if (role === MemberType.ADMIN) {
			// Bootstrap only this isolated database; public signup still cannot create admins.
			await connection
				.collection('members')
				.updateOne({ _id: new Types.ObjectId(actor.id) }, { $set: { memberType: MemberType.ADMIN } });
			actor.token = await login(nick);
		}
		return actor;
	}

	async function login(nick: string) {
		const result = await graphql<{ login: LoginResult }>(
			'mutation Login($input: LoginInput!) { login(input: $input) { accessToken member { _id } } }',
			{ input: { memberNick: nick, memberPassword: password } },
		);
		expect(result.errors).toBeUndefined();
		return result.data!.login.accessToken;
	}

	function manage(memberId: string, changes: Record<string, unknown>, token = controller.token) {
		return graphql(
			'mutation Manage($input: MemberAdminUpdate!) { updateMemberByAdmin(input: $input) { _id } }',
			{ input: { memberId, ...changes } },
			token,
		);
	}

	function listMembers(token: string) {
		return graphql(adminQuery, { input: { page: 1, limit: 10, search: {} } }, token);
	}

	async function graphql<T>(
		query: string,
		variables: Record<string, unknown> = {},
		token?: string,
	): Promise<Result<T>> {
		const pending = request(app.getHttpServer()).post('/graphql');
		if (token) pending.set('Authorization', `Bearer ${token}`);
		const response = await pending.send({ query, variables }).expect(200);
		return JSON.parse(response.text) as Result<T>;
	}
});
