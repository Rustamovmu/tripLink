import './auth-test-support';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import type { SecurityMember } from '../src/components/auth/account-security.service';
const bcryptApi = bcrypt as unknown as { hash(value: string, rounds: number): Promise<string> };
import { AppModule } from '../src/app.module';
import { OidcProviderService } from '../src/components/auth/oidc-provider.service';
import { AccountSecurityService } from '../src/components/auth/account-security.service';
import { AuthRecordsService } from '../src/components/auth/auth-records.service';
import { TokenService } from '../src/components/auth/token.service';
jest.setTimeout(60000);
type Actor = { client: ReturnType<typeof request.agent>; token: string; id: string; sid: string; nick: string };

interface SecurityResponse {
	errors?: { message: string }[];
	data: {
		signup: { accessToken: string; member: { _id: string; memberType: string } };
		login: { accessToken: string; member: { _id: string; memberType: string } };
	};
	accessToken: string;
	member: { _id: string; memberType: string; memberNick: string };
	returnTo: string;
	hasPassword: boolean;
	identities: { provider: string }[];
	authorizationUrl: string;
	codes: string[];
	emailDeliveryAvailable: boolean;
	authCode: string;
}
const wire = (response: { body: unknown }) => response.body as SecurityResponse;

const password = 'A memorable travel passphrase!';
const headers = { Origin: 'http://localhost:3000', 'X-TripLink-Auth': '1' };
describe('Unified account security (real HTTP/MongoDB; mocked provider exchange and SMTP)', () => {
	let app: INestApplication,
		db: Connection,
		database: string,
		originalMongo: string | undefined,
		counter = 0;
	const assertDatabase = () => {
		if (db.name !== database || !/^tl_sec_e2e_[a-f0-9]{24}$/.test(database))
			throw new Error('Unexpected security fixture database');
	};
	beforeAll(async () => {
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = 'tl_sec_e2e_' + new Types.ObjectId().toHexString();
		const url = new URL(originalMongo);
		url.pathname = '/' + database;
		process.env.MONGO_DEV = url.toString();
		const providers = {
			available: () => ['GOOGLE', 'TELEGRAM', 'KAKAO'],
			frontend: 'http://localhost:3000',
			get: (value: string) => ({
				provider: value.toUpperCase(),
				clientId: 'fixture',
				authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
			}),
			authorization: (_config: unknown, state: string, nonce: string) =>
				`https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`,
			exchange: jest.fn((config: { provider: string }, code: string) => ({
				provider: config.provider,
				subject: code,
				name: 'Social fixture',
				email: code === 'email-conflict' ? 'owned@example.com' : undefined,
				emailVerified: code === 'email-conflict',
			})),
		};
		const module = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(OidcProviderService)
			.useValue(providers)
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		db = app.get(getConnectionToken());
		assertDatabase();
		await app.init();
		for (const name of ['Member', 'AuthIdentity', 'AuthTransaction', 'AuthSecurity', 'AuthRateLimit', 'RefreshSession'])
			await db.model(name).init();
	});
	afterAll(async () => {
		try {
			if (db) {
				assertDatabase();
				await db.dropDatabase();
			}
		} finally {
			try {
				if (app) await app.close();
			} finally {
				process.env.MONGO_DEV = originalMongo;
			}
		}
	});
	const gql = (client: ReturnType<typeof request.agent>, query: string, input?: unknown, token?: string) =>
		client
			.post('/graphql')
			.set(headers)
			.set(token ? { Authorization: 'Bearer ' + token } : {})
			.send({ query, variables: { input } });
	async function signup(nick = 'secure_' + ++counter, email?: string): Promise<Actor> {
		const client = request.agent(app.getHttpServer());
		const result = await gql(
			client,
			'mutation($input:MemberInput!){signup(input:$input){accessToken member{_id memberType}}}',
			{ memberNick: nick, memberPassword: password, ...(email ? { memberEmail: email } : {}) },
		);
		expect(wire(result).errors).toBeUndefined();
		const data = wire(result).data.signup;
		expect(data.member.memberType).toBe('USER');
		const claims = await app.get(TokenService).verifyAccess(data.accessToken);
		return { client, token: data.accessToken, id: data.member._id, sid: claims.sid, nick };
	}
	const api = (actor: Actor, path: string, body: object = {}, method = 'post') =>
		method === 'get'
			? actor.client
					.get('/auth/' + path)
					.set(headers)
					.set('Authorization', 'Bearer ' + actor.token)
			: method === 'delete'
				? actor.client
						.delete('/auth/' + path)
						.set(headers)
						.set('Authorization', 'Bearer ' + actor.token)
				: actor.client
						.post('/auth/' + path)
						.set(headers)
						.set('Authorization', 'Bearer ' + actor.token)
						.send(body);
	async function oauth(
		client: ReturnType<typeof request.agent>,
		provider: string,
		code: string,
		intent = 'LOGIN',
		token?: string,
	) {
		const start = await client
			.post(`/auth/oauth/${provider}/start`)
			.set(headers)
			.set(token ? { Authorization: 'Bearer ' + token } : {})
			.send({ intent, returnTo: '/tour/detail?id=fixture' });
		expect(start.status).toBe(201);
		const state = new URL(wire(start).authorizationUrl).searchParams.get('state');
		return client.get(`/auth/oauth/${provider}/callback`).query({ state, code });
	}
	async function social(provider = 'telegram', subject = 'subject_' + ++counter): Promise<Actor> {
		const client = request.agent(app.getHttpServer());
		const callback = await oauth(client, provider, subject);
		expect(callback.headers.location).toBe('http://localhost:3000/account/onboarding');
		const complete = await client
			.post('/auth/social/onboarding')
			.set(headers)
			.send({ memberNick: 'social_' + ++counter });
		expect(complete.status).toBe(201);
		const claims = await app.get(TokenService).verifyAccess(wire(complete).accessToken);
		return {
			client,
			token: wire(complete).accessToken,
			id: wire(complete).member._id,
			sid: claims.sid,
			nick: wire(complete).member.memberNick,
		};
	}
	const current = (actor: Actor) =>
		gql(actor.client, 'query{getCurrentMember{_id memberType}}', undefined, actor.token);
	it('registers without email/phone, hashes with Argon2id, and keeps credentials private', async () => {
		const a = await signup();
		const row = await db.collection('members').findOne({ _id: new Types.ObjectId(a.id) });
		expect(row?.memberPassword).toMatch(/^\$argon2id\$/);
		expect(row?.memberPhone).toBeUndefined();
		expect(row?.memberEmail).toBeUndefined();
		const result = await api(a, 'security', {}, 'get');
		expect(wire(result).hasPassword).toBe(true);
		expect(JSON.stringify(wire(result))).not.toContain(row?.memberPassword);
	});
	it('enforces case-insensitive uniqueness under concurrent signup requests', async () => {
		const nick = 'case_' + ++counter;
		const query = 'mutation($input:MemberInput!){signup(input:$input){member{_id}}}';
		const results = await Promise.all([
			gql(request.agent(app.getHttpServer()), query, { memberNick: nick.toUpperCase(), memberPassword: password }),
			gql(request.agent(app.getHttpServer()), query, { memberNick: nick, memberPassword: password }),
		]);
		expect(results.filter((r) => !wire(r).errors)).toHaveLength(1);
		expect(await db.collection('members').countDocuments({ memberNick: nick })).toBe(1);
	});
	it.each(['admin', 'john doe', 'john@doe', 'ab'])('rejects unsupported/reserved signup %s', async (memberNick) => {
		const result = await gql(
			request.agent(app.getHttpServer()),
			'mutation($input:MemberInput!){signup(input:$input){member{_id}}}',
			{ memberNick, memberPassword: password },
		);
		expect(wire(result).errors).toBeDefined();
	});
	it.each(['AGENT', 'ADMIN'])('never assigns public signup role %s', async (memberType) => {
		const result = await gql(
			request.agent(app.getHttpServer()),
			'mutation($input:MemberInput!){signup(input:$input){member{_id}}}',
			{ memberNick: 'role_' + ++counter, memberPassword: password, memberType },
		);
		expect(wire(result).errors).toBeDefined();
	});
	it('authenticates a grandfathered name and bcrypt password, rehashing without replacing ID or role', async () => {
		const member = await db.model<SecurityMember>('Member').create({
			memberNick: 'Legacy Name',
			memberPassword: await bcryptApi.hash('Legacy12!', 12),
			memberType: 'AGENT',
		});
		const client = request.agent(app.getHttpServer());
		const result = await gql(
			client,
			'mutation($input:LoginInput!){login(input:$input){accessToken member{_id memberType}}}',
			{ memberNick: 'legacy name', memberPassword: 'Legacy12!' },
		);
		expect(wire(result).errors).toBeUndefined();
		expect(wire(result).data.login.member).toEqual({ _id: String(member._id), memberType: 'AGENT' });
		const stored = await db.collection('members').findOne({ _id: member._id });
		expect(stored?.memberPassword).toMatch(/^\$argon2id\$/);
		expect(stored?.memberNick).toBe('Legacy Name');
	});
	it('returns generic errors for nonexistent users and incorrect passwords', async () => {
		const a = await signup();
		const query = 'mutation($input:LoginInput!){login(input:$input){member{_id}}}';
		const absent = await gql(a.client, query, { memberNick: 'nonexistent', memberPassword: password });
		const incorrect = await gql(a.client, query, { memberNick: a.nick, memberPassword: 'incorrect password' });
		expect(wire(absent).errors![0].message).toBe(wire(incorrect).errors![0].message);
	});
	it.each(['google', 'telegram', 'kakao'])('onboards %s users without password, phone or email', async (provider) => {
		const a = await social(provider);
		const row = await db.collection('members').findOne({ _id: new Types.ObjectId(a.id) });
		expect(row?.memberPassword).toBeUndefined();
		expect(row?.memberEmail).toBeUndefined();
		expect(row?.memberPhone).toBeUndefined();
		expect(row?.memberType).toBe('USER');
		expect(wire(await current(a)).errors).toBeUndefined();
	});
	it('signs a returning provider into the same member and uses a one-time browser handoff', async () => {
		const subject = 'repeat_' + ++counter,
			a = await social('google', subject),
			client = request.agent(app.getHttpServer());
		const callback = await oauth(client, 'google', subject);
		expect(callback.headers.location).toBe('http://localhost:3000/account/complete');
		expect(String(callback.headers['set-cookie'])).not.toContain('triplink_refresh=');
		const result = await client.post('/auth/social/finish').set(headers).send({});
		expect(result.status).toBe(201);
		expect(wire(result).member._id).toBe(a.id);
		expect(wire(result).returnTo).toBe('/tour/detail?id=fixture');
		expect((await client.post('/auth/social/finish').set(headers).send({})).status).toBe(401);
	});
	it('binds state to its browser, prevents replay and separates providers', async () => {
		const client = request.agent(app.getHttpServer());
		const start = await client.post('/auth/oauth/google/start').set(headers).send({ intent: 'LOGIN' });
		const state = new URL(wire(start).authorizationUrl).searchParams.get('state');
		const stolen = await request(app.getHttpServer())
			.get('/auth/oauth/google/callback')
			.query({ state, code: 'stolen' });
		expect(stolen.headers.location).toContain('provider-failed');
		const wrong = await client.get('/auth/oauth/kakao/callback').query({ state, code: 'wrong' });
		expect(wrong.headers.location).toContain('provider-failed');
		expect(
			(await client.get('/auth/oauth/google/callback').query({ state, code: 'replay' })).headers.location,
		).toContain('provider-failed');
	});
	it('handles provider cancellation and blocks unsafe OAuth initiation origins', async () => {
		const client = request.agent(app.getHttpServer());
		expect((await client.post('/auth/oauth/google/start').send({ intent: 'LOGIN' })).status).toBe(403);
		const start = await client.post('/auth/oauth/google/start').set(headers).send({ intent: 'LOGIN' });
		const state = new URL(wire(start).authorizationUrl).searchParams.get('state');
		const cancelled = await client.get('/auth/oauth/google/callback').query({ state, error: 'access_denied' });
		expect(cancelled.headers.location).toContain('authError=cancelled');
	});
	it('requires explicit linking on email conflicts without merging accounts', async () => {
		const a = await signup(undefined, 'owned@example.com');
		const client = request.agent(app.getHttpServer());
		const result = await oauth(client, 'google', 'email-conflict');
		expect(result.headers.location).toContain('link-required');
		expect(await db.collection('authIdentities').countDocuments({ memberId: new Types.ObjectId(a.id) })).toBe(0);
	});
	it('links to the initiating member only and rejects identity ownership transfers', async () => {
		const a = await signup(),
			b = await signup(),
			subject = 'linked_' + ++counter;
		const link = await oauth(a.client, 'kakao', subject, 'LINK', a.token);
		expect(link.headers.location).toContain('security=1');
		expect(wire(await api(a, 'security', {}, 'get')).identities.map((i: { provider: string }) => i.provider)).toEqual([
			'KAKAO',
		]);
		const denied = await oauth(b.client, 'kakao', subject, 'LINK', b.token);
		expect(denied.headers.location).toContain('provider-failed');
		expect(wire(await api(b, 'security', {}, 'get')).identities).toHaveLength(0);
	});
	it('preserves a linked ADMIN role on provider sign-in', async () => {
		const a = await signup();
		await db.collection('members').updateOne({ _id: new Types.ObjectId(a.id) }, { $set: { memberType: 'ADMIN' } });
		const result = await gql(a.client, 'mutation($input:LoginInput!){login(input:$input){accessToken}}', {
			memberNick: a.nick,
			memberPassword: password,
		});
		a.token = wire(result).data.login.accessToken;
		const subject = 'admin_provider_' + ++counter;
		await oauth(a.client, 'google', subject, 'LINK', a.token);
		const client = request.agent(app.getHttpServer());
		await oauth(client, 'google', subject);
		const login = await client.post('/auth/social/finish').set(headers).send({});
		expect(wire(login).member._id).toBe(a.id);
		expect(wire(login).member.memberType).toBe('ADMIN');
	});
	it('prevents unlinking the last method, then permits adding a password and unlinking', async () => {
		const a = await social();
		expect((await api(a, 'identities/telegram', {}, 'delete')).status).toBe(400);
		expect((await api(a, 'password/set', { password })).status).toBe(201);
		expect((await api(a, 'identities/telegram', {}, 'delete')).status).toBe(200);
		const status = await api(a, 'security', {}, 'get');
		expect(wire(status).hasPassword).toBe(true);
		expect(wire(status).identities).toHaveLength(0);
		expect(wire(await current(a)).errors).toBeUndefined();
	});
	it('serializes concurrent unlinking so at least one usable provider remains', async () => {
		const a = await social('telegram');
		await oauth(a.client, 'google', 'second_' + ++counter, 'LINK', a.token);
		const results = await Promise.all([
			api(a, 'identities/telegram', {}, 'delete'),
			api(a, 'identities/google', {}, 'delete'),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
		expect(wire(await api(a, 'security', {}, 'get')).identities).toHaveLength(1);
	});
	it('requires recent reauthentication and rejects a wrong password without revoking the session', async () => {
		const a = await signup();
		await db
			.collection('refreshSessions')
			.updateOne(
				{ _id: new Types.ObjectId(a.sid) },
				{ $set: { lastAuthenticatedAt: new Date(Date.now() - 6 * 60000) } },
			);
		expect(wire(await api(a, 'recovery-codes/generate')).authCode).toBe('REAUTHENTICATION_REQUIRED');
		expect((await api(a, 'security/reauthenticate', { password: 'wrong' })).status).toBe(400);
		expect(wire(await current(a)).errors).toBeUndefined();
		expect((await api(a, 'security/reauthenticate', { password })).status).toBe(201);
		expect((await api(a, 'recovery-codes/generate')).status).toBe(201);
	});
	it('stores only recovery hashes, consumes codes once and revokes all existing sessions', async () => {
		const a = await signup();
		const result = await api(a, 'recovery-codes/generate');
		expect(wire(result).codes).toHaveLength(10);
		const code = wire(result).codes[0];
		const record = await db.collection('authSecurity').findOne({ memberId: new Types.ObjectId(a.id) });
		expect(JSON.stringify(record)).not.toContain(code);
		const body = { memberNick: a.nick, recoveryCode: code, password: 'New memorable travel passphrase!' };
		const responses = await Promise.all([
			a.client.post('/auth/password/reset').set(headers).send(body),
			a.client.post('/auth/password/reset').set(headers).send(body),
		]);
		expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
		expect(wire(await current(a)).errors).toBeDefined();
		expect(
			(await db.collection('authSecurity').findOne({ memberId: new Types.ObjectId(a.id) }))?.recoveryCodeHashes,
		).toHaveLength(9);
	});
	it('does not deliver reset mail without a verified recovery address and returns the same response', async () => {
		const a = await signup();
		const known = await a.client.post('/auth/password/forgot').set(headers).send({ identifier: a.nick });
		const unknown = await a.client.post('/auth/password/forgot').set(headers).send({ identifier: 'missing_account' });
		expect(wire(known)).toEqual(wire(unknown));
		expect(wire(await api(a, 'security', {}, 'get')).emailDeliveryAvailable).toBe(false);
	});
	it('verifies a recovery email and atomically consumes a reset token (mock SMTP)', async () => {
		const a = await signup();
		const actual: unknown = app.get<AccountSecurityService>(AccountSecurityService);
		const service = actual as { mail?: { sendMail: jest.Mock<Promise<unknown>, [{ text: string }]> } };
		const sendMail = jest.fn<Promise<unknown>, [{ text: string }]>().mockResolvedValue({});
		service.mail = { sendMail };
		try {
			expect((await api(a, 'email/verification/request', { email: 'recovery@example.com' })).status).toBe(201);
			const verify = sendMail.mock.calls[0][0].text.split('#verify=')[1];
			expect(
				(await a.client.post('/auth/email/verification/confirm').set(headers).send({ token: verify })).status,
			).toBe(201);
			expect(
				(await a.client.post('/auth/email/verification/confirm').set(headers).send({ token: verify })).status,
			).toBe(401);
			const requested = await a.client.post('/auth/password/forgot').set(headers).send({ identifier: a.nick });
			expect(requested.status).toBe(201);
			const reset = sendMail.mock.calls[1][0].text.split('#reset=')[1];
			const input = { token: reset, password: 'Another memorable travel passphrase!' };
			expect((await a.client.post('/auth/password/reset').set(headers).send(input)).status).toBe(201);
			expect((await a.client.post('/auth/password/reset').set(headers).send(input)).status).toBe(401);
			expect(wire(await current(a)).errors).toBeDefined();
		} finally {
			service.mail = undefined;
		}
	});
	it('expires one-time recovery credentials even before MongoDB TTL cleanup', async () => {
		const a = await signup();
		const raw = await app.get(AuthRecordsService).create('RESET', { memberId: a.id, revision: 0 }, -1);
		expect((await a.client.post('/auth/password/reset').set(headers).send({ token: raw, password })).status).toBe(401);
	});
	it('rejects linking without authentication and rejects suspended accounts on security endpoints', async () => {
		expect(
			(await request(app.getHttpServer()).post('/auth/oauth/google/start').set(headers).send({ intent: 'LINK' }))
				.status,
		).toBe(400);
		const a = await signup();
		await db
			.collection('members')
			.updateOne({ _id: new Types.ObjectId(a.id) }, { $set: { memberStatus: 'SUSPENDED' } });
		expect((await api(a, 'security', {}, 'get')).status).toBe(403);
	});
});
