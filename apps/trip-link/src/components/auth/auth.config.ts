import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthConfig {
	readonly issuer = 'triplink';
	readonly audience = 'triplink-api';
	readonly accessSecret: string;
	readonly refreshSecret: string;
	readonly accessSeconds = 900;
	readonly refreshSeconds = 7 * 86400;
	readonly sessionSeconds = 30 * 86400;
	readonly origins: string[];
	readonly secure: boolean;
	readonly sameSite: 'lax' | 'strict' | 'none';
	readonly cookieName: string;
	readonly trustProxyHops: number;
	constructor(config: ConfigService) {
		this.accessSecret = config.get<string>('JWT_ACCESS_SECRET') ?? '';
		this.refreshSecret = config.get<string>('JWT_REFRESH_SECRET') ?? '';
		if (this.accessSecret.length < 32 || this.refreshSecret.length < 32 || this.accessSecret === this.refreshSecret)
			throw new Error('Configure distinct JWT_ACCESS_SECRET and JWT_REFRESH_SECRET of at least 32 characters');
		for (const [key, expected] of [
			['JWT_ACCESS_EXPIRES_IN', '15m'],
			['JWT_REFRESH_EXPIRES_IN', '7d'],
			['JWT_SESSION_MAX_AGE', '30d'],
		]) {
			if (config.get<string>(key) && config.get<string>(key) !== expected)
				throw new Error(`${key} must be ${expected}`);
		}
		const production = config.get<string>('NODE_ENV') === 'production';
		const proxyHops = config.get<string>('AUTH_TRUST_PROXY_HOPS') ?? '0';
		if (!/^[0-5]$/.test(proxyHops)) throw new Error('AUTH_TRUST_PROXY_HOPS must be an integer from 0 to 5');
		this.trustProxyHops = Number(proxyHops);
		this.origins = (config.get<string>('FRONTEND_ORIGINS') ?? (production ? '' : 'http://localhost:3000'))
			.split(',')
			.map((v) => v.trim())
			.filter(Boolean);
		if (
			!this.origins.length ||
			this.origins.some((origin) => {
				try {
					const url = new URL(origin);
					return (
						url.origin !== origin ||
						!['http:', 'https:'].includes(url.protocol) ||
						(production && url.protocol !== 'https:')
					);
				} catch {
					return true;
				}
			})
		)
			throw new Error('FRONTEND_ORIGINS must contain explicit allowed HTTP origins (HTTPS in production)');
		this.secure = production || config.get<string>('AUTH_COOKIE_SECURE') === 'true';
		const sameSite = config.get<string>('AUTH_COOKIE_SAME_SITE') ?? 'lax';
		if (!['lax', 'strict', 'none'].includes(sameSite) || (sameSite === 'none' && !this.secure))
			throw new Error('Invalid AUTH_COOKIE_SAME_SITE / AUTH_COOKIE_SECURE');
		this.sameSite = sameSite as 'lax' | 'strict' | 'none';
		this.cookieName = this.secure ? '__Secure-triplink_refresh' : 'triplink_refresh';
	}
}
