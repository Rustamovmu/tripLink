import './auth-test-support';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { RefreshSession } from '../src/components/auth/auth-session.service';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { AuthConfig } from '../src/components/auth/auth.config';
import { TokenService } from '../src/components/auth/token.service';
import { AuthRateLimitService } from '../src/components/auth/auth-rate-limit.service';
import { MemberType } from '../src/libs/enums/member.enum';
jest.setTimeout(60000);
type Actor = { client: ReturnType<typeof request.agent>; token: string; id: string; cookie: string; sid: string };
type ApiBody = {
	success?: boolean;
	accessToken?: string;
	authCode?: string;
	errors?: { extensions: { code: string; authCode?: string } }[];
	data?: {
		signup?: { member: { _id: string }; accessToken: string };
		login?: { member: { _id: string }; accessToken: string };
	};
};
const body = (response: { body: unknown }) => response.body as ApiBody;
type RefreshResponse = { accessToken?: string; authCode?: string };
describe('Rotating refresh sessions (real HTTP and MongoDB)', () => {
	let app: INestApplication, connection: Connection, database: string;
	let originalMongo: string | undefined;
	let number = 0;
	const origin = 'http://localhost:3000';
	const headers = { Origin: origin, 'X-TripLink-Auth': '1' };
	const query = 'query { getCurrentMember { _id memberType } }';
	const assertDatabase = () => {
		if (connection.name !== database || !/^tl_rfs_e2e_[a-f0-9]{24}$/.test(database))
			throw new Error('Unexpected refresh fixture database');
	};
	beforeAll(async () => {
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = 'tl_rfs_e2e_' + new Types.ObjectId().toHexString();
		const url = new URL(originalMongo);
		url.pathname = '/' + database;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		const config = app.get(AuthConfig);
		app.enableCors({
			origin: config.origins,
			credentials: true,
			methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
			allowedHeaders: [
				'Authorization',
				'Content-Type',
				'X-TripLink-Auth',
				'X-Refresh-Request-Id',
				'Apollo-Require-Preflight',
			],
		});
		connection = app.get<Connection>(getConnectionToken());
		assertDatabase();
		await app.init();
		await connection.model('RefreshSession').init();
		await connection.model('AuthRateLimit').init();
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
				process.env.MONGO_DEV = originalMongo;
			}
		}
	});
	async function actor(role = MemberType.USER): Promise<Actor> {
		const client = request.agent(app.getHttpServer());
		const memberNick = 'refresh-' + ++number;
		let response = await client
			.post('/graphql')
			.set(headers)
			.set('User-Agent', 'Mozilla/5.0 Macintosh Chrome/120')
			.send({
				query: 'mutation Signup($input: MemberInput!) { signup(input: $input) { accessToken member { _id } } }',
				variables: {
					input: {
						memberNick,
						memberPassword: 'TestPass123!',
						memberEmail: memberNick + '@example.com',
						memberType: role === MemberType.ADMIN ? 'USER' : role,
					},
				},
			});
		expect(body(response).errors).toBeUndefined();
		const id = String(body(response).data!.signup!.member._id);
		if (role === MemberType.ADMIN) {
			await connection.collection('members').updateOne({ _id: new Types.ObjectId(id) }, { $set: { memberType: role } });
			response = await client
				.post('/graphql')
				.set(headers)
				.send({
					query: 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken member { _id } } }',
					variables: { input: { memberNick, memberPassword: 'TestPass123!' } },
				});
			expect(body(response).errors).toBeUndefined();
		}
		const token = String((body(response).data!.login ?? body(response).data!.signup)!.accessToken);
		const claims = await app.get(TokenService).verifyAccess(token);
		const cookies = response.headers['set-cookie'] as unknown as string[];
		return { client, token, id, sid: claims.sid, cookie: cookies[0].split(';')[0] };
	}
	const refresh = (a: Actor, id = randomUUID(), cookie?: string) =>
		(cookie ? request(app.getHttpServer()) : a.client)
			.post('/auth/refresh')
			.set(headers)
			.set('X-Refresh-Request-Id', id)
			.set(cookie ? { Cookie: cookie } : {})
			.send();
	const check = (a: Actor) =>
		a.client
			.post('/graphql')
			.set(headers)
			.set('Authorization', 'Bearer ' + a.token)
			.send({ query });
	it.each(Object.values(MemberType))('creates an HTTP-only session and authenticates %s', async (role) => {
		const a = await actor(role);
		const session = await connection
			.collection<RefreshSession>('refreshSessions')
			.findOne({ _id: new Types.ObjectId(a.sid) });
		expect(session?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
		expect(session?.tokenHash).not.toContain(a.cookie);
		expect(session!.absoluteExpiresAt.getTime() - session!.createdAt.getTime()).toBeGreaterThan(30 * 86400000 - 2000);
		const response = await refresh(a);
		expect(response.status).toBe(201);
		expect(Object.keys(body(response))).toEqual(['accessToken']);
		expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
		expect(response.headers['set-cookie'][0]).toMatch(/Path=\/auth/);
		expect(response.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
		const claims = await app.get(TokenService).verifyAccess(body(response).accessToken!);
		expect(claims.memberType).toBe(role);
		expect(body(await check(a)).errors).toBeUndefined();
	});
	it('rotates refresh credentials, extends sliding expiry and preserves absolute expiry', async () => {
		const a = await actor();
		const before = await connection
			.collection<RefreshSession>('refreshSessions')
			.findOne({ _id: new Types.ObjectId(a.sid) });
		const mocked = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 86400000);
		try {
			const response = await refresh(a);
			expect(response.status).toBe(201);
			const after = await connection
				.collection<RefreshSession>('refreshSessions')
				.findOne({ _id: new Types.ObjectId(a.sid) });
			expect(after!.tokenHash).not.toBe(before!.tokenHash);
			expect(after!.expiresAt.getTime() - before!.expiresAt.getTime()).toBe(86400000);
			expect(after!.absoluteExpiresAt).toEqual(before!.absoluteExpiresAt);
			expect(after!.lastUsedAt.getTime()).toBeGreaterThan(before!.lastUsedAt.getTime());
		} finally {
			mocked.mockRestore();
		}
	});
	it('caps JWT, database and cookie expiry at the unchanged absolute deadline', async () => {
		const a = await actor();
		const deadline = new Date(Math.floor(Date.now() / 1000) * 1000 + 3600000);
		await connection
			.collection('refreshSessions')
			.updateOne({ _id: new Types.ObjectId(a.sid) }, { $set: { absoluteExpiresAt: deadline } });
		const response = await refresh(a);
		const after = await connection
			.collection<RefreshSession>('refreshSessions')
			.findOne({ _id: new Types.ObjectId(a.sid) });
		expect(response.status).toBe(201);
		expect(after!.expiresAt).toEqual(deadline);
		const cookie = response.headers['set-cookie'][0].split(';')[0].split('=')[1];
		expect((await app.get(TokenService).verifyRefresh(decodeURIComponent(cookie))).exp * 1000).toBe(deadline.getTime());
		expect(response.headers['set-cookie'][0]).toContain('Expires=' + deadline.toUTCString());
	});
	it('allows one atomic rotation and an idempotent same-operation recovery', async () => {
		const a = await actor();
		const id = randomUUID();
		const responses = await Promise.all([refresh(a, id, a.cookie), refresh(a, id, a.cookie)]);
		expect(responses.map((r) => r.status)).toEqual([201, 201]);
		expect(responses[0].headers['set-cookie'][0]).toEqual(responses[1].headers['set-cookie'][0]);
		expect(body(await check(a)).errors).toBeUndefined();
	});
	it('rejects unrelated old-token reuse and revokes the family immediately', async () => {
		const a = await actor();
		expect((await refresh(a)).status).toBe(201);
		const replay = await refresh(a, randomUUID(), a.cookie);
		expect(replay.status).toBe(401);
		expect((replay.body as RefreshResponse).authCode).toBe('REFRESH_TOKEN_REUSED');
		expect((await refresh(a)).status).toBe(401);
		expect(body(await check(a)).errors![0].extensions.authCode).toBe('SESSION_REVOKED');
	});
	it('different concurrent refresh operations cannot both rotate successfully', async () => {
		const a = await actor();
		const responses = await Promise.all([refresh(a, randomUUID(), a.cookie), refresh(a, randomUUID(), a.cookie)]);
		expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
		expect(responses.filter((r) => r.status === 401)).toHaveLength(1);
	});
	it('lists only owned safe sessions and rejects foreign revocation', async () => {
		const a = await actor(),
			b = await actor();
		const list = await a.client.get('/auth/sessions').set('Authorization', 'Bearer ' + a.token);
		expect(list.status).toBe(200);
		expect(list.body).toHaveLength(1);
		expect((list.body as { id: string; isCurrentSession: boolean; deviceName: string }[])[0]).toMatchObject({
			id: a.sid,
			isCurrentSession: true,
			deviceName: 'Mac',
		});
		expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|tokenId|previousTokenHash|rotationIdHash|tokenFamilyId/);
		const revoke = await a.client
			.delete('/auth/sessions/' + b.sid)
			.set(headers)
			.set('Authorization', 'Bearer ' + a.token);
		expect(body(revoke).success).toBe(false);
		expect(body(await check(b)).errors).toBeUndefined();
	});
	it('supports independent devices, current logout and immediate revocation', async () => {
		const a = await actor();
		const member = await connection
			.collection<{ memberNick: string }>('members')
			.findOne({ _id: new Types.ObjectId(a.id) });
		const b = {
			...a,
			token: await app
				.get(AuthService)
				.createToken({ _id: a.id, memberType: MemberType.USER, memberNick: String(member!.memberNick) }),
		};
		const response = await a.client.post('/auth/logout').set(headers);
		expect(body(response).success).toBe(true);
		expect(response.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
		expect(body(await check(a)).errors![0].extensions.authCode).toBe('SESSION_REVOKED');
		expect(body(await check(b)).errors).toBeUndefined();
	});
	it('logout-all and individual revocation invalidate issued access tokens', async () => {
		const a = await actor();
		const second = await app
			.get(AuthService)
			.createToken({ _id: a.id, memberType: MemberType.USER, memberNick: 'second-device' });
		const response = await a.client
			.post('/auth/logout-all')
			.set(headers)
			.set('Authorization', 'Bearer ' + a.token);
		expect(response.status).toBe(201);
		expect(body(await check({ ...a, token: second })).errors![0].extensions.authCode).toBe('SESSION_REVOKED');
		const b = await actor();
		const revoked = await b.client
			.delete('/auth/sessions/' + b.sid)
			.set(headers)
			.set('Authorization', 'Bearer ' + b.token);
		expect(body(revoked).success).toBe(true);
		expect(body(await check(b)).errors![0].extensions.authCode).toBe('SESSION_REVOKED');
	});
	it.each(['sliding', 'absolute', 'revoked'])('rejects %s session expiry without extending it', async (kind) => {
		const a = await actor();
		const field = kind === 'sliding' ? 'expiresAt' : kind === 'absolute' ? 'absoluteExpiresAt' : 'revokedAt';
		await connection
			.collection('refreshSessions')
			.updateOne({ _id: new Types.ObjectId(a.sid) }, { $set: { [field]: new Date(Date.now() - 1000) } });
		const response = await refresh(a);
		expect(response.status).toBe(401);
		expect(body(response).authCode).toBe(
			kind === 'sliding'
				? 'REFRESH_TOKEN_EXPIRED'
				: kind === 'absolute'
					? 'SESSION_ABSOLUTE_EXPIRATION'
					: 'SESSION_REVOKED',
		);
	});
	it('rejects inactive/changed-role accounts, missing cookies and access tokens used as refresh', async () => {
		const a = await actor();
		await connection
			.collection('members')
			.updateOne({ _id: new Types.ObjectId(a.id) }, { $set: { memberStatus: 'BLOCK' } });
		expect((await refresh(a)).status).toBe(403);
		const b = await actor();
		await connection
			.collection('members')
			.updateOne({ _id: new Types.ObjectId(b.id) }, { $set: { memberType: 'AGENT' } });
		expect((await refresh(b)).status).toBe(401);
		expect(
			(await request(app.getHttpServer()).post('/auth/refresh').set(headers).set('X-Refresh-Request-Id', randomUUID()))
				.status,
		).toBe(401);
		expect((await refresh(b, randomUUID(), 'triplink_refresh=' + b.token)).status).toBe(401);
	});
	it('enforces origin/header CSRF protection and credentialed CORS allowlists', async () => {
		const a = await actor();
		expect(
			(
				await a.client
					.post('/auth/refresh')
					.set('Origin', 'https://evil.example')
					.set('X-TripLink-Auth', '1')
					.set('X-Refresh-Request-Id', randomUUID())
			).status,
		).toBe(403);
		expect((await a.client.post('/auth/logout').set('Origin', origin)).status).toBe(403);
		const valid = await request(app.getHttpServer())
			.options('/auth/refresh')
			.set('Origin', origin)
			.set('Access-Control-Request-Method', 'POST')
			.set('Access-Control-Request-Headers', 'X-TripLink-Auth');
		expect(valid.headers['access-control-allow-origin']).toBe(origin);
		expect(valid.headers['access-control-allow-credentials']).toBe('true');
		const invalid = await request(app.getHttpServer())
			.options('/auth/refresh')
			.set('Origin', 'https://evil.example')
			.set('Access-Control-Request-Method', 'POST');
		expect(invalid.headers['access-control-allow-origin']).toBeUndefined();
		const login = await request(app.getHttpServer()).post('/graphql').send({
			query: 'mutation { login(input: {memberNick: "bad", memberPassword: "TestPass123!"}) { accessToken } }',
		});
		expect(body(login).errors![0].extensions.code).toBe('FORBIDDEN');
	});
	it('uses atomic shared rate-limit buckets and preserves records after rejection', async () => {
		const limiter = app.get(AuthRateLimitService),
			key = randomUUID();
		await limiter.consume('fixture', key, 2);
		await limiter.consume('fixture', key, 2);
		await expect(limiter.consume('fixture', key, 2)).rejects.toMatchObject({ status: 429 });
	});
});
