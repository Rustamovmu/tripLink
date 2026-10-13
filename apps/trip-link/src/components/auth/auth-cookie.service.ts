import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthConfig } from './auth.config';
@Injectable()
export class AuthCookieService {
	constructor(private readonly config: AuthConfig) {}
	assertBrowserRequest(req: Request) {
		// Require a non-simple header and an exact allowlisted Origin. SameSite alone is not CSRF protection.
		if (
			req.headers['x-triplink-auth'] !== '1' ||
			typeof req.headers.origin !== 'string' ||
			!this.config.origins.includes(req.headers.origin)
		)
			throw new ForbiddenException('Authentication request origin is not allowed');
	}
	read(req: Request) {
		const value = req.headers.cookie
			?.split(';')
			.map((v) => v.trim())
			.find((v) => v.startsWith(this.config.cookieName + '='))
			?.slice(this.config.cookieName.length + 1);
		if (!value || value.length > 4096) return '';
		try {
			return decodeURIComponent(value);
		} catch {
			return '';
		}
	}
	set(res: Response, payload: { refreshToken: string; refreshExpiresAt: Date }) {
		res.cookie(this.config.cookieName, payload.refreshToken, {
			httpOnly: true,
			secure: this.config.secure,
			sameSite: this.config.sameSite,
			path: '/auth',
			expires: payload.refreshExpiresAt,
			maxAge: Math.max(0, payload.refreshExpiresAt.getTime() - Date.now()),
		});
		res.setHeader('Cache-Control', 'no-store');
	}
	clear(res: Response) {
		res.clearCookie(this.config.cookieName, {
			httpOnly: true,
			secure: this.config.secure,
			sameSite: this.config.sameSite,
			path: '/auth',
		});
		res.setHeader('Cache-Control', 'no-store');
	}
}
