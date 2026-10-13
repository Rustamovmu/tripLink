import { Controller, Delete, Get, Param, Post, Req, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { AuthTokenPayload } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AuthCookieService } from './auth-cookie.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { TokenService, authFailure } from './token.service';
import { AuthGuard } from './guards/auth.guard';
@Controller('auth')
export class AuthController {
	constructor(
		private readonly sessions: AuthSessionService,
		private readonly cookies: AuthCookieService,
		private readonly limits: AuthRateLimitService,
		private readonly tokens: TokenService,
	) {}
	@Post('refresh')
	async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
		this.cookies.assertBrowserRequest(req);
		await this.limits.consume('refresh-ip', req.ip ?? 'unknown', 120);
		const rotationId = req.headers['x-refresh-request-id'];
		if (typeof rotationId !== 'string' || !/^[a-f0-9-]{36}$/.test(rotationId))
			throw new BadRequestException('A refresh request identifier is required');
		const raw = this.cookies.read(req);
		if (!raw) {
			this.cookies.clear(res);
			throw authFailure('UNAUTHORIZED');
		}
		try {
			const payload = await this.sessions.rotate(raw, rotationId);
			this.cookies.set(res, payload);
			return { accessToken: payload.accessToken };
		} catch (error: unknown) {
			// Do not erase a newer cookie on a stale failed request. Client clears state on definitive failure.
			res.setHeader('Cache-Control', 'no-store');
			throw error;
		}
	}
	@Post('logout')
	async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
		this.cookies.assertBrowserRequest(req);
		await this.limits.consume('logout-ip', req.ip ?? 'unknown', 120);
		const raw = this.cookies.read(req);
		if (raw) {
			try {
				const claims = await this.tokens.verifyRefresh(raw);
				await this.sessions.revoke(claims.sid, claims.sub);
			} catch (error: unknown) {
				if (!(error instanceof Error) || !('getStatus' in error)) throw error;
			}
		}
		this.cookies.clear(res);
		return { success: true };
	}
	@UseGuards(AuthGuard)
	@Post('logout-all')
	async logoutAll(@Req() req: Request & { authMember: AuthTokenPayload }, @Res({ passthrough: true }) res: Response) {
		this.cookies.assertBrowserRequest(req);
		await this.sessions.revokeAll(req.authMember.sub);
		this.cookies.clear(res);
		return { success: true };
	}
	@UseGuards(AuthGuard)
	@Get('sessions')
	async sessionsList(
		@Req() req: Request & { authMember: AuthTokenPayload },
		@Res({ passthrough: true }) res: Response,
	) {
		res.setHeader('Cache-Control', 'no-store');
		return this.sessions.list(req.authMember.sub, req.authMember.sid);
	}
	@UseGuards(AuthGuard)
	@Delete('sessions/:sessionId')
	async revoke(
		@Param('sessionId') sessionId: string,
		@Req() req: Request & { authMember: AuthTokenPayload },
		@Res({ passthrough: true }) res: Response,
	) {
		this.cookies.assertBrowserRequest(req);
		if (!isValidObjectId(sessionId)) throw new BadRequestException('Invalid session identifier');
		const result = await this.sessions.revoke(sessionId, req.authMember.sub);
		if (sessionId === req.authMember.sid) this.cookies.clear(res);
		return { success: result.matchedCount > 0 };
	}
}
