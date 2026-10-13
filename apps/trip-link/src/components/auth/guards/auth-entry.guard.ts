import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { AuthCookieService } from '../auth-cookie.service';
import { AuthRateLimitService } from '../auth-rate-limit.service';
@Injectable()
export class AuthEntryGuard implements CanActivate {
	constructor(
		private readonly cookies: AuthCookieService,
		private readonly limits: AuthRateLimitService,
	) {}
	async canActivate(context: ExecutionContext) {
		const gql = GqlExecutionContext.create(context);
		const req = gql.getContext<{ req: Request }>().req;
		this.cookies.assertBrowserRequest(req);
		await this.limits.consume('login-ip', req.ip ?? 'unknown', 30);
		const input = gql.getArgs<{ input?: { memberNick?: string } }>().input;
		if (typeof input?.memberNick === 'string')
			await this.limits.consume('login-nick', input.memberNick.trim().toLowerCase(), 10, 900000);
		return true;
	}
}
