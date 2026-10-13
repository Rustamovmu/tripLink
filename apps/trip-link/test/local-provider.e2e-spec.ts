import './auth-test-support';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { OidcProviderService } from '../src/components/auth/oidc-provider.service';
import { TokenService } from '../src/components/auth/token.service';
import type { RefreshSession } from '../src/components/auth/auth-session.service';

jest.setTimeout(60000);
const headers = { Origin: 'http://localhost:3000', 'X-TripLink-Auth': '1' };
const password = 'An isolated testing passphrase!';
type Client = ReturnType<typeof request.agent>;
type Member = {
	_id: string;
	memberNick: string;
	memberType: string;
	memberFullname?: string;
};
type Payload = { accessToken: string; member: Member; returnTo: string };
type Wire = Payload & {
	data: { signup: Payload; login: Payload; getCurrentMember: Member };
	errors?: { message: string; extensions: { code: string } }[];
	authorizationUrl: string;
	identities: { provider: string }[];
};
const wire = (r: { body: unknown }) => r.body as Wire;
describe('Local Google/Kakao acceptance (real HTTP/MongoDB; mocked provider exchange)', () => {
	let app: INestApplication, db: Connection, database: string, originalMongo: string | undefined;
	let number = 0;
	const guard = () => {
		if (db.name !== database || !/^tl_local_auth_[a-f0-9]{24}$/.test(database))
			throw new Error('Unexpected local authentication fixture database');
	};
	beforeAll(async () => {
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = 'tl_local_auth_' + new Types.ObjectId().toHexString();
		const url = new URL(originalMongo);
		url.pathname = '/' + database;
		process.env.MONGO_DEV = url.toString();
		const provider = {
			available: () => ['GOOGLE', 'KAKAO'],
			frontend: headers.Origin,
			get: (value: string) => {
				if (!['google', 'kakao'].includes(value)) throw new Error('Provider unavailable');
				return { provider: value.toUpperCase() };
			},
			authorization: (_: unknown, state: string) => 'https://accounts.google.com/o/oauth2/v2/auth?state=' + state,
			exchange: (config: { provider: string }, code: string) => {
				if (!code || code === 'invalid-code') throw new Error('Invalid provider code');
				return {
					provider: config.provider,
					subject: code,
					emailVerified: false,
				};
			},
		};
		const module = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(OidcProviderService)
			.useValue(provider)
			.compile();
		app = module.createNestApplication();
		db = app.get(getConnectionToken());
		guard();
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			}),
		);
		await app.init();
		for (const name of ['Member', 'AuthIdentity', 'AuthTransaction', 'AuthSecurity', 'AuthRateLimit', 'RefreshSession'])
			await db.model(name).init();
	});
	beforeEach(async () => {
		guard();
		// Isolate each scenario's fixture rate-limit bucket; production limits remain unchanged.
		await db.collection('authRateLimits').deleteMany({});
	});
	afterAll(async () => {
		try {
			if (db) {
				guard();
				// Remove only disposable fixture records; never drop a database or collection.
				for (const collection of Object.values(db.collections)) {
					guard();
					await collection.deleteMany({});
				}
			}
		} finally {
			try {
				if (app) await app.close();
			} finally {
				process.env.MONGO_DEV = originalMongo;
			}
		}
	});
	const gql = (client: Client, query: string, input?: unknown, token?: string) =>
		client
			.post('/graphql')
			.set(headers)
			.set(token ? { Authorization: 'Bearer ' + token } : {})
			.send({ query, variables: { input } });
	const current = (client: Client, token: string) =>
		gql(client, 'query { getCurrentMember { _id memberNick memberType memberFullname } }', undefined, token);
	async function local() {
		const client = request.agent(app.getHttpServer()),
			memberNick = 'local_' + ++number;
		const response = await gql(
			client,
			'mutation($input:MemberInput!){signup(input:$input){accessToken member{_id memberNick memberType}}}',
			{ memberNick, memberPassword: password },
		);
		expect(wire(response).errors).toBeUndefined();
		return { client, ...wire(response).data.signup };
	}
	async function start(client: Client, provider: string, intent = 'LOGIN', token?: string) {
		const r = await client
			.post(`/auth/oauth/${provider}/start`)
			.set(headers)
			.set(token ? { Authorization: 'Bearer ' + token } : {})
			.send({ intent, returnTo: '/mypage?category=security' });
		expect(r.status).toBe(201);
		return new URL(wire(r).authorizationUrl).searchParams.get('state')!;
	}
	async function callback(client: Client, provider: string, code: string, intent = 'LOGIN', token?: string) {
		const state = await start(client, provider, intent, token);
		return client.get(`/auth/oauth/${provider}/callback`).query({ state, code });
	}
	async function social(provider: string, subject = 'subject_' + ++number) {
		const client = request.agent(app.getHttpServer());
		expect((await callback(client, provider, subject)).headers.location).toBe(headers.Origin + '/account/onboarding');
		const info = await client.get('/auth/social/onboarding').set(headers);
		expect(info.status).toBe(200);
		expect((info.body as { suggestedName: string }).suggestedName).toBe('');
		const response = await client
			.post('/auth/social/onboarding')
			.set(headers)
			.send({ memberNick: 'provider_' + ++number });
		expect(response.status).toBe(201);
		return { client, subject, ...wire(response) };
	}
	it('keeps username/password registration, login, duplicate protection, profile and logout working', async () => {
		const a = await local();
		const duplicate = await gql(
			request.agent(app.getHttpServer()),
			'mutation($input:MemberInput!){signup(input:$input){member{_id}}}',
			{
				memberNick: a.member.memberNick.toUpperCase(),
				memberPassword: password,
			},
		);
		expect(wire(duplicate).errors).toBeDefined();
		const query = 'mutation($input:LoginInput!){login(input:$input){accessToken member{_id memberNick memberType}}}';
		for (const input of [
			{ memberNick: a.member.memberNick, memberPassword: 'incorrect password' },
			{ memberNick: 'absent_fixture', memberPassword: password },
		])
			expect(wire(await gql(a.client, query, input)).errors).toBeDefined();
		await a.client.post('/auth/logout').set(headers).expect(201);
		expect(wire(await current(a.client, a.accessToken)).errors).toBeDefined();
		const login = await gql(a.client, query, {
			memberNick: a.member.memberNick,
			memberPassword: password,
		});
		expect(wire(login).errors).toBeUndefined();
		expect(wire(login).data.login.member).toEqual(a.member);
		expect(wire(await current(a.client, wire(login).data.login.accessToken)).errors).toBeUndefined();
		expect(await db.collection('members').countDocuments({ memberNick: a.member.memberNick })).toBe(1);
	});
	describe.each(['google', 'kakao'])('%s', (provider) => {
		it('rotates through controlled days 5, 11, 17, 23 and 29 without moving day 30', async () => {
			const a = await social(provider),
				claims = await app.get(TokenService).verifyAccess(a.accessToken);
			const initial = await db
				.collection<RefreshSession>('refreshSessions')
				.findOne({ _id: new Types.ObjectId(claims.sid) });
			const issuedAt = initial!.expiresAt.getTime() - 7 * 86400000;
			const clock = jest.spyOn(Date, 'now');
			try {
				for (const day of [5, 11, 17, 23, 29]) {
					clock.mockReturnValue(issuedAt + day * 86400000);
					await a.client.post('/auth/refresh').set(headers).set('X-Refresh-Request-Id', randomUUID()).expect(201);
					const session = await db
						.collection<RefreshSession>('refreshSessions')
						.findOne({ _id: new Types.ObjectId(claims.sid) });
					expect(session!.absoluteExpiresAt).toEqual(initial!.absoluteExpiresAt);
					expect(session!.expiresAt.getTime()).toBe(issuedAt + Math.min(day + 7, 30) * 86400000);
				}
				clock.mockReturnValue(issuedAt + 30 * 86400000);
				await a.client.post('/auth/refresh').set(headers).set('X-Refresh-Request-Id', randomUUID()).expect(401);
			} finally {
				clock.mockRestore();
			}
		});
		it('rolls back a second onboarding attempt for the same permanent identity', async () => {
			const subject = 'duplicate_' + ++number;
			const clients = [request.agent(app.getHttpServer()), request.agent(app.getHttpServer())];
			for (const client of clients) await callback(client, provider, subject);
			const nicks = ['race_' + ++number, 'race_' + ++number];
			const responses = await Promise.all(
				clients.map((client, index) =>
					client.post('/auth/social/onboarding').set(headers).send({ memberNick: nicks[index] }),
				),
			);
			expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
			expect(await db.collection('members').countDocuments({ memberNick: { $in: nicks } })).toBe(1);
			expect(
				await db
					.collection('authIdentities')
					.countDocuments({ provider: provider.toUpperCase(), providerUserId: subject }),
			).toBe(1);
		});
		it('onboards without email/password/profile and restores the same member after logout and repeated login', async () => {
			const a = await social(provider);
			expect(a.member.memberType).toBe('USER');
			const row = await db.collection('members').findOne({ _id: new Types.ObjectId(a.member._id) });
			expect(row?.memberPassword).toBeUndefined();
			expect(row?.memberEmail).toBeUndefined();
			expect(row?.memberPhone).toBeUndefined();
			await a.client.post('/auth/logout').set(headers).expect(201);
			const client = request.agent(app.getHttpServer());
			expect((await callback(client, provider, a.subject)).headers.location).toBe(headers.Origin + '/account/complete');
			const finish = await client.post('/auth/social/finish').set(headers).send({});
			expect(finish.status).toBe(201);
			expect(wire(finish).member).toEqual(a.member);
			expect(wire(finish).returnTo).toBe('/mypage?category=security');
			await client.post('/auth/social/finish').set(headers).send({}).expect(401);
			expect(
				await db.collection('authIdentities').countDocuments({
					provider: provider.toUpperCase(),
					providerUserId: a.subject,
				}),
			).toBe(1);
			expect(await db.collection('members').countDocuments({ memberNick: a.member.memberNick })).toBe(1);
		});
		it('rejects invalid state, replay, missing/invalid code and handles cancellation without creating members', async () => {
			const count = await db.collection('members').countDocuments();
			for (const scenario of ['state', 'missing', 'invalid', 'cancel']) {
				const client = request.agent(app.getHttpServer()),
					state = await start(client, provider);
				const query =
					scenario === 'state'
						? { state: 'invalid-state', code: 'unused' }
						: scenario === 'missing'
							? { state }
							: scenario === 'invalid'
								? { state, code: 'invalid-code' }
								: { state, error: 'access_denied' };
				const response = await client.get(`/auth/oauth/${provider}/callback`).query(query);
				expect(response.headers.location).toContain(
					scenario === 'cancel' ? 'authError=cancelled' : 'authError=provider-failed',
				);
				expect(
					(
						await client
							.get(`/auth/oauth/${provider}/callback`)
							.query({ state: scenario === 'state' ? 'invalid-state' : state, code: 'replay' })
					).headers.location,
				).toContain('provider-failed');
			}
			expect(await db.collection('members').countDocuments()).toBe(count);
		});
		it('links explicitly to the original member, rejects foreign ownership, and unlinks without changing profile', async () => {
			const a = await local(),
				b = await local(),
				subject = 'link_' + ++number;
			expect((await callback(a.client, provider, subject, 'LINK', a.accessToken)).headers.location).toContain(
				'security=1',
			);
			expect((await callback(b.client, provider, subject, 'LINK', b.accessToken)).headers.location).toContain(
				'provider-failed',
			);
			const client = request.agent(app.getHttpServer());
			await callback(client, provider, subject);
			const login = await client.post('/auth/social/finish').set(headers).send({});
			expect(wire(login).member).toMatchObject(a.member);
			await a.client
				.delete('/auth/identities/' + provider)
				.set(headers)
				.set('Authorization', 'Bearer ' + a.accessToken)
				.expect(200);
			expect(wire(await current(a.client, a.accessToken)).data.getCurrentMember._id).toBe(a.member._id);
			expect(await db.collection('authIdentities').countDocuments({ memberId: new Types.ObjectId(a.member._id) })).toBe(
				0,
			);
		});
		it('protects the final login method and requires recent authentication for linking', async () => {
			const a = await social(provider);
			await a.client
				.delete('/auth/identities/' + provider)
				.set(headers)
				.set('Authorization', 'Bearer ' + a.accessToken)
				.expect(400);
			const claims = await app.get(TokenService).verifyAccess(a.accessToken);
			await db
				.collection('refreshSessions')
				.updateOne(
					{ _id: new Types.ObjectId(claims.sid) },
					{ $set: { lastAuthenticatedAt: new Date(Date.now() - 6 * 60000) } },
				);
			await a.client
				.post('/auth/oauth/' + provider + '/start')
				.set(headers)
				.set('Authorization', 'Bearer ' + a.accessToken)
				.send({ intent: 'LINK' })
				.expect(403);
			expect(wire(await current(a.client, a.accessToken)).errors).toBeUndefined();
		});
		it('shares refresh rotation, hashed credentials, fixed lifetime, profile restoration and logout infrastructure', async () => {
			const a = await social(provider),
				tokens = app.get(TokenService),
				claims = await tokens.verifyAccess(a.accessToken);
			expect(claims.exp! - claims.iat!).toBe(900);
			const before = await db
				.collection<RefreshSession>('refreshSessions')
				.findOne({ _id: new Types.ObjectId(claims.sid) });
			expect(before?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
			expect(before!.absoluteExpiresAt.getTime() - before!.expiresAt.getTime()).toBe(23 * 86400000);
			const refreshed = await a.client.post('/auth/refresh').set(headers).set('X-Refresh-Request-Id', randomUUID());
			expect(refreshed.status).toBe(201);
			expect(refreshed.headers['set-cookie'][0]).toMatch(/HttpOnly/);
			expect(refreshed.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
			const after = await db
				.collection<RefreshSession>('refreshSessions')
				.findOne({ _id: new Types.ObjectId(claims.sid) });
			expect(after!.tokenHash).not.toBe(before!.tokenHash);
			expect(after!.absoluteExpiresAt).toEqual(before!.absoluteExpiresAt);
			expect(wire(await current(a.client, wire(refreshed).accessToken)).data.getCurrentMember._id).toBe(a.member._id);
			await a.client.post('/auth/logout').set(headers).expect(201);
			expect(wire(await current(a.client, wire(refreshed).accessToken)).errors).toBeDefined();
			await a.client.post('/auth/refresh').set(headers).set('X-Refresh-Request-Id', randomUUID()).expect(401);
		});
		it('rejects suspended linked accounts before issuing a session', async () => {
			const a = await social(provider);
			await db
				.collection('members')
				.updateOne({ _id: new Types.ObjectId(a.member._id) }, { $set: { memberStatus: 'SUSPENDED' } });
			expect((await callback(request.agent(app.getHttpServer()), provider, a.subject)).headers.location).toContain(
				'provider-failed',
			);
		});
	});
	it('connects both providers to one member without merging accounts', async () => {
		const a = await local();
		for (const provider of ['google', 'kakao']) {
			const subject = 'unified_' + ++number;
			expect((await callback(a.client, provider, subject, 'LINK', a.accessToken)).headers.location).toContain(
				'security=1',
			);
			const client = request.agent(app.getHttpServer());
			await callback(client, provider, subject);
			expect(wire(await client.post('/auth/social/finish').set(headers).send({})).member).toMatchObject(a.member);
		}
		expect(await db.collection('authIdentities').countDocuments({ memberId: new Types.ObjectId(a.member._id) })).toBe(
			2,
		);
	});
});
