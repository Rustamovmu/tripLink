import { ConfigService } from '@nestjs/config';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AuthConfig } from './auth.config';
import { OidcProviderService, ProviderConfig } from './oidc-provider.service';
import { Provider } from './auth-records.service';
describe('Official OIDC adapters (offline signed tokens; no provider credentials)', () => {
	let service: OidcProviderService, privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
	const originalFetch = global.fetch;
	beforeAll(async () => {
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey;
		const jwk = await exportJWK(pair.publicKey);
		jwk.kid = 'fixture-key';
		const config = new ConfigService({
			FRONTEND_ORIGINS: 'http://localhost:3000',
			JWT_ACCESS_SECRET: 'a'.repeat(32),
			JWT_REFRESH_SECRET: 'b'.repeat(32),
			GOOGLE_ENABLED: 'true',
			GOOGLE_CLIENT_ID: 'google-test',
			GOOGLE_CLIENT_SECRET: 'test-only',
			GOOGLE_CALLBACK_URL: 'http://localhost:3007/auth/oauth/google/callback',
			TELEGRAM_ENABLED: 'true',
			TELEGRAM_CLIENT_ID: '12345',
			TELEGRAM_CLIENT_SECRET: 'test-only',
			TELEGRAM_CALLBACK_URL: 'http://localhost:3007/auth/oauth/telegram/callback',
			KAKAO_ENABLED: 'true',
			KAKAO_REST_API_KEY: 'kakao-test',
			KAKAO_CLIENT_SECRET: 'test-only',
			KAKAO_CALLBACK_URL: 'http://localhost:3007/auth/oauth/kakao/callback',
		});
		service = new OidcProviderService(config, new AuthConfig(config));
		const keys = (service as unknown as { keys: Map<Provider, unknown> }).keys;
		for (const provider of ['GOOGLE', 'TELEGRAM', 'KAKAO'] as Provider[])
			keys.set(provider, createLocalJWKSet({ keys: [jwk] }));
	});
	it('rejects strict refresh cookies when a provider is enabled', () => {
		const config = new ConfigService({
			FRONTEND_ORIGINS: 'http://localhost:3000',
			JWT_ACCESS_SECRET: 'a'.repeat(32),
			JWT_REFRESH_SECRET: 'b'.repeat(32),
			AUTH_COOKIE_SAME_SITE: 'strict',
			GOOGLE_ENABLED: 'true',
		});
		expect(() => new OidcProviderService(config, new AuthConfig(config))).toThrow(/SAME_SITE/);
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});
	const token = (config: ProviderConfig, claims: Record<string, unknown> = {}) =>
		new SignJWT({ sub: 'permanent-subject', nonce: 'nonce', name: 'Fixture', ...claims })
			.setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
			.setIssuer(config.issuer)
			.setAudience(config.clientId)
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(privateKey);
	it.each(['GOOGLE', 'TELEGRAM', 'KAKAO'])(
		'validates %s signatures and uses code flow, S256, state and nonce',
		async (value) => {
			const config = service.get(value),
				jwt = await token(config);
			global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: jwt }), { status: 200 }));
			const result = await service.exchange(config, 'authorization-code', 'nonce', 'verifier');
			expect(result).toMatchObject({ provider: value, subject: 'permanent-subject', emailVerified: false });
			const url = new URL(service.authorization(config, 'state', 'nonce', 'verifier'));
			expect(url.searchParams.get('code_challenge_method')).toBe('S256');
			expect(url.searchParams.get('nonce')).toBe('nonce');
			expect(url.searchParams.get('state')).toBe('state');
			expect(url.searchParams.get('scope')).not.toMatch(/phone|bot_access|write/);
			const options = (
				global.fetch as jest.Mock<
					Promise<Response>,
					[string, { body: URLSearchParams; headers: Record<string, string> }]
				>
			).mock.calls[0][1];
			expect(options.body.get('code_verifier')).toBe('verifier');
			if (value === 'TELEGRAM') {
				expect(options.headers.Authorization).toMatch(/^Basic /);
				expect(options.body.has('client_secret')).toBe(false);
			}
		},
	);
	it.each(['GOOGLE', 'TELEGRAM', 'KAKAO'])('does not trust a mismatched %s nonce', async (value) => {
		const config = service.get(value);
		global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: await token(config) })));
		await expect(service.exchange(config, 'code', 'wrong-nonce', 'verifier')).rejects.toThrow();
	});
	it.each(['issuer', 'audience', 'expired', 'future', 'unsigned', 'signature'])('rejects %s tokens', async (kind) => {
		const config = service.get('GOOGLE');
		const signer = new SignJWT({ sub: 'subject', nonce: 'nonce' })
			.setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
			.setIssuer(kind === 'issuer' ? 'https://evil.invalid' : config.issuer)
			.setAudience(kind === 'audience' ? 'wrong-client' : config.clientId)
			.setIssuedAt(kind === 'future' ? Math.floor(Date.now() / 1000) + 600 : undefined)
			.setExpirationTime(kind === 'expired' ? '-5m' : '5m');
		let jwt = await signer.sign(kind === 'signature' ? (await generateKeyPair('RS256')).privateKey : privateKey);
		if (kind === 'unsigned')
			jwt =
				Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') +
				'.' +
				Buffer.from(JSON.stringify({ sub: 'subject' })).toString('base64url') +
				'.';
		global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: jwt })));
		await expect(service.exchange(config, 'code', 'nonce', 'verifier')).rejects.toThrow();
	});
	it('rejects multi-audience tokens without the authorized-party claim', async () => {
		const config = service.get('GOOGLE');
		const jwt = await new SignJWT({ sub: 'subject', nonce: 'nonce' })
			.setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
			.setIssuer(config.issuer)
			.setAudience([config.clientId, 'other'])
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(privateKey);
		global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: jwt })));
		await expect(service.exchange(config, 'code', 'nonce', 'verifier')).rejects.toThrow();
	});
	it('supports missing email/profile data without inventing contact information', () => {
		expect(service.identity(service.get('TELEGRAM'), { sub: 'stable', nonce: 'expected' }, 'expected')).toMatchObject({
			subject: 'stable',
			email: undefined,
			emailVerified: false,
		});
	});
	it('hides disabled providers and fails startup on invalid enabled configuration', () => {
		const config = new ConfigService({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });
		expect(new OidcProviderService(config, new AuthConfig(config)).available()).toEqual([]);
		const invalid = new ConfigService({
			JWT_ACCESS_SECRET: 'a'.repeat(32),
			JWT_REFRESH_SECRET: 'b'.repeat(32),
			GOOGLE_ENABLED: 'true',
		});
		expect(() => new OidcProviderService(invalid, new AuthConfig(invalid))).toThrow(/Configure GOOGLE/);
	});
});
