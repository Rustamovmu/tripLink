import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { AuthConfig } from './auth.config';
import { TokenService } from './token.service';
import { MemberType } from '../../libs/enums/member.enum';
const settings = {
	JWT_ACCESS_SECRET: 'unit-access-secret-at-least-32-characters',
	JWT_REFRESH_SECRET: 'unit-refresh-secret-at-least-32-characters',
};
describe('Session token contracts', () => {
	const config = new AuthConfig(new ConfigService(settings));
	const jwt = new JwtService();
	const tokens = new TokenService(jwt, config);
	const member = { _id: new Types.ObjectId(), memberType: MemberType.USER, memberNick: 'Traveler' };
	const sid = new Types.ObjectId().toHexString();
	afterEach(() => jest.restoreAllMocks());
	it('uses minimal typed 15-minute access claims', async () => {
		const token = await tokens.access(member, sid);
		const claims = await tokens.verifyAccess(token);
		expect(claims.exp! - claims.iat!).toBe(900);
		expect(claims).toMatchObject({ sub: String(member._id), sid, type: 'access', memberType: 'USER' });
		expect(Object.keys(claims).sort()).toEqual([
			'aud',
			'exp',
			'iat',
			'iss',
			'memberNick',
			'memberType',
			'sid',
			'sub',
			'type',
		]);
	});
	it('sets refresh expiration exactly and does not interchange token types', async () => {
		const now = Math.floor(Date.now() / 1000);
		const refresh = await tokens.refresh(String(member._id), sid, now, now + 604800);
		expect((await tokens.verifyRefresh(refresh)).exp).toBe(now + 604800);
		await expect(tokens.verifyAccess(refresh)).rejects.toMatchObject({ response: { authCode: 'UNAUTHORIZED' } });
		await expect(tokens.verifyRefresh(await tokens.access(member, sid))).rejects.toMatchObject({
			response: { authCode: 'UNAUTHORIZED' },
		});
	});
	it('distinguishes expired access and refresh credentials with mocked time', async () => {
		const now = Date.now();
		const access = await tokens.access(member, sid);
		const refresh = await tokens.refresh(
			String(member._id),
			sid,
			Math.floor(now / 1000),
			Math.floor(now / 1000) + 604800,
		);
		jest.spyOn(Date, 'now').mockReturnValue(now + 901000);
		await expect(tokens.verifyAccess(access)).rejects.toMatchObject({ response: { authCode: 'ACCESS_TOKEN_EXPIRED' } });
		jest.spyOn(Date, 'now').mockReturnValue(now + 604801000);
		await expect(tokens.verifyRefresh(refresh)).rejects.toMatchObject({
			response: { authCode: 'REFRESH_TOKEN_EXPIRED' },
		});
	});
	it('rejects missing, equal, short secrets and unsafe production/cross-site settings', () => {
		for (const environment of [
			{},
			{ ...settings, JWT_REFRESH_SECRET: settings.JWT_ACCESS_SECRET },
			{ ...settings, JWT_ACCESS_SECRET: 'short' },
			{ ...settings, AUTH_COOKIE_SAME_SITE: 'none' },
			{ ...settings, NODE_ENV: 'production' },
			{ ...settings, JWT_ACCESS_EXPIRES_IN: '30d' },
			{ ...settings, FRONTEND_ORIGINS: '*' },
			{ ...settings, AUTH_TRUST_PROXY_HOPS: 'true' },
		])
			expect(
				() => new AuthConfig({ get: (key: string) => (environment as Record<string, string>)[key] } as ConfigService),
			).toThrow();
		const productionSettings: Record<string, string> = {
			...settings,
			NODE_ENV: 'production',
			FRONTEND_ORIGINS: 'https://triplink.example',
			AUTH_COOKIE_SAME_SITE: 'none',
		};
		const production = new AuthConfig({ get: (key: string) => productionSettings[key] } as ConfigService);
		expect(production.secure).toBe(true);
		expect(production.cookieName).toBe('__Secure-triplink_refresh');
	});
	it('rejects missing session IDs, refresh-type claims signed with access key and wrong algorithms', async () => {
		for (const claims of [
			{ sub: String(member._id), memberType: 'USER' },
			{ sub: String(member._id), sid, memberType: 'USER', type: 'refresh' },
		]) {
			await expect(
				tokens.verifyAccess(await jwt.signAsync(claims, { secret: settings.JWT_ACCESS_SECRET, expiresIn: 900 })),
			).rejects.toBeDefined();
		}
		await expect(
			tokens.verifyAccess(
				await jwt.signAsync(
					{ sub: String(member._id), sid, memberType: 'USER', type: 'access' },
					{ secret: settings.JWT_ACCESS_SECRET, algorithm: 'HS384', expiresIn: 900 },
				),
			),
		).rejects.toBeDefined();
	});
});
