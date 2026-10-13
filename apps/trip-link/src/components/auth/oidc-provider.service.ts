import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { createHash } from 'crypto';
import { Provider } from './auth-records.service';
import { AuthConfig } from './auth.config';
export interface VerifiedIdentity {
	provider: Provider;
	subject: string;
	name?: string;
	email?: string;
	emailVerified: boolean;
	picture?: string;
}
export interface ProviderConfig {
	provider: Provider;
	clientId: string;
	secret: string;
	callback: string;
	issuer: string;
	authorization: string;
	token: string;
	jwks: string;
	scope: string;
}
const endpoints = {
	GOOGLE: {
		issuer: 'https://accounts.google.com',
		authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
		token: 'https://oauth2.googleapis.com/token',
		jwks: 'https://www.googleapis.com/oauth2/v3/certs',
		scope: 'openid email profile',
	},
	TELEGRAM: {
		issuer: 'https://oauth.telegram.org',
		authorization: 'https://oauth.telegram.org/auth',
		token: 'https://oauth.telegram.org/token',
		jwks: 'https://oauth.telegram.org/.well-known/jwks.json',
		scope: 'openid profile',
	},
	KAKAO: {
		issuer: 'https://kauth.kakao.com',
		authorization: 'https://kauth.kakao.com/oauth/authorize',
		token: 'https://kauth.kakao.com/oauth/token',
		jwks: 'https://kauth.kakao.com/.well-known/jwks.json',
		scope: 'openid',
	},
};
@Injectable()
export class OidcProviderService {
	private readonly configured = new Map<Provider, ProviderConfig>();
	private readonly keys = new Map<Provider, ReturnType<typeof createRemoteJWKSet>>();
	readonly frontend: string;
	constructor(config: ConfigService, auth: AuthConfig) {
		this.frontend = config.get<string>('AUTH_FRONTEND_URL') ?? auth.origins[0];
		if (!auth.origins.includes(this.frontend))
			throw new Error('AUTH_FRONTEND_URL must be an allowlisted frontend origin');
		for (const provider of Object.keys(endpoints) as Provider[]) {
			if (config.get<string>(`${provider}_ENABLED`) !== 'true') continue;
			if (auth.sameSite === 'strict')
				throw new Error('Enabled OAuth providers require AUTH_COOKIE_SAME_SITE=lax or none for account-link callbacks');
			const clientId = config.get<string>(provider === 'KAKAO' ? 'KAKAO_REST_API_KEY' : `${provider}_CLIENT_ID`) ?? '';
			const secret = config.get<string>(`${provider}_CLIENT_SECRET`) ?? '';
			const callback = config.get<string>(`${provider}_CALLBACK_URL`) ?? '';
			let valid = false;
			try {
				const url = new URL(callback);
				valid =
					!url.search &&
					!url.hash &&
					!url.username &&
					!url.password &&
					url.pathname === `/auth/oauth/${provider.toLowerCase()}/callback` &&
					(url.protocol === 'https:' ||
						(config.get('NODE_ENV') !== 'production' &&
							url.protocol === 'http:' &&
							['localhost', '127.0.0.1'].includes(url.hostname)));
			} catch {
				/* Invalid enabled providers fail startup. */
			}
			if (!clientId || !secret || !valid)
				throw new Error(`Configure ${provider} client credentials and exact callback URL before enabling it`);
			this.configured.set(provider, { provider, clientId, secret, callback, ...endpoints[provider] });
			this.keys.set(
				provider,
				createRemoteJWKSet(new URL(endpoints[provider].jwks), { timeoutDuration: 10000, cooldownDuration: 30000 }),
			);
		}
	}
	available() {
		return [...this.configured.keys()];
	}
	get(value: string): ProviderConfig {
		const result = this.configured.get(value.toUpperCase() as Provider);
		if (!result) throw new BadRequestException('This sign-in provider is currently unavailable.');
		return result;
	}
	authorization(config: ProviderConfig, state: string, nonce: string, verifier: string, reauth = false) {
		const url = new URL(config.authorization);
		url.search = new URLSearchParams({
			client_id: config.clientId,
			redirect_uri: config.callback,
			response_type: 'code',
			scope: config.scope,
			state,
			nonce,
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			code_challenge_method: 'S256',
			...(reauth ? { prompt: config.provider === 'GOOGLE' ? 'select_account' : 'login', max_age: '0' } : {}),
		}).toString();
		return url.toString();
	}
	async exchange(config: ProviderConfig, code: string, nonce: string, verifier: string): Promise<VerifiedIdentity> {
		if (!code || code.length > 4096) throw new BadRequestException('Provider sign-in failed. Please try again.');
		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: config.clientId,
			redirect_uri: config.callback,
			code,
			code_verifier: verifier,
		});
		const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
		if (config.provider === 'TELEGRAM')
			headers.Authorization = 'Basic ' + Buffer.from(`${config.clientId}:${config.secret}`).toString('base64');
		else body.set('client_secret', config.secret);
		const response = await fetch(config.token, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(10000),
			redirect: 'error',
		});
		if (!response.ok) throw new BadRequestException('Provider sign-in failed. Please try again.');
		const tokens = (await response.json()) as { id_token?: unknown };
		if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 16384)
			throw new BadRequestException('Provider sign-in failed. Please try again.');
		// Provider access/refresh tokens are discarded; TripLink owns its session lifecycle.
		const { payload } = await jwtVerify(tokens.id_token, this.keys.get(config.provider)!, {
			issuer: config.provider === 'GOOGLE' ? [config.issuer, 'accounts.google.com'] : config.issuer,
			audience: config.clientId,
			algorithms: ['RS256'],
			requiredClaims: ['sub', 'iss', 'aud', 'iat', 'exp', 'nonce'],
			maxTokenAge: '10m',
			clockTolerance: 5,
		});
		return this.identity(config, payload, nonce);
	}
	identity(config: ProviderConfig, payload: JWTPayload, nonce: string): VerifiedIdentity {
		if (
			payload.nonce !== nonce ||
			typeof payload.sub !== 'string' ||
			!payload.sub ||
			payload.sub.length > 255 ||
			(payload.azp !== undefined && payload.azp !== config.clientId) ||
			(Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId)
		)
			throw new BadRequestException('Provider sign-in failed. Please try again.');
		const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);
		const picture = text(payload.picture, 500);
		return {
			provider: config.provider,
			subject: payload.sub,
			name: text(payload.name ?? payload.nickname, 100),
			email: text(payload.email, 254),
			emailVerified: payload.email_verified === true,
			picture: picture?.startsWith('https://') ? picture : undefined,
		};
	}
}
