import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthGuard } from './guards/auth.guard';
import { AuthService, AuthTokenPayload } from './auth.service';
import { AuthCookieService } from './auth-cookie.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthSessionService } from './auth-session.service';
import { AccountSecurityService } from './account-security.service';
import { SocialAuthService } from './social-auth.service';
import type { OAuthIntent } from './social-auth.service';
import { OidcProviderService } from './oidc-provider.service';
import { Provider } from './auth-records.service';
class PasswordBody {
	@IsString() @Length(1, 1024) password!: string;
}
class EmailBody {
	@IsEmail() @MaxLength(254) email!: string;
}
class TokenBody {
	@IsString() @Length(43, 43) token!: string;
}
class ForgotBody {
	@IsString() @Length(1, 254) identifier!: string;
}
class ResetBody extends PasswordBody {
	@IsOptional() @IsString() @Length(43, 43) token?: string;
	@IsOptional() @IsString() @Length(1, 30) memberNick?: string;
	@IsOptional() @IsString() @Length(24, 24) recoveryCode?: string;
}
class StartBody {
	@IsIn(['LOGIN', 'LINK', 'REAUTH']) intent!: OAuthIntent;
	@IsOptional() @IsString() @MaxLength(2000) returnTo?: string;
}
class OnboardingBody {
	@IsString() @Length(3, 30) memberNick!: string;
	@IsOptional() @IsString() @Length(2, 100) memberFullname?: string;
}
type AuthRequest = Request & { authMember: AuthTokenPayload };
@Controller('auth')
export class AccountSecurityController {
	constructor(
		private readonly security: AccountSecurityService,
		private readonly social: SocialAuthService,
		private readonly providers: OidcProviderService,
		private readonly cookies: AuthCookieService,
		private readonly limits: AuthRateLimitService,
		private readonly auth: AuthService,
		private readonly sessions: AuthSessionService,
	) {}
	private async browser(req: Request, res: Response, scope: string, maximum = 15) {
		this.cookies.assertBrowserRequest(req);
		res.setHeader('Cache-Control', 'no-store');
		await this.limits.consume(scope, req.ip ?? 'unknown', maximum, 15 * 60000);
	}
	@Get('providers')
	available(@Res({ passthrough: true }) res: Response) {
		res.setHeader('Cache-Control', 'no-store');
		return { providers: this.providers.available() };
	}
	@Post('oauth/:provider/start')
	async start(
		@Param('provider') provider: string,
		@Body() body: StartBody,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	) {
		await this.browser(req, res, 'oauth-start', 30);
		let actor: AuthTokenPayload | undefined;
		if (body.intent !== 'LOGIN') {
			const authorization = req.headers.authorization;
			if (!authorization?.startsWith('Bearer ')) throw new BadRequestException('Sign in again to continue.');
			actor = await this.auth.verifyToken(authorization.slice(7));
		}
		return this.social.start(provider, body.intent, body.returnTo ?? '/', req, res, actor);
	}
	@Get('oauth/:provider/callback')
	async callback(
		@Param('provider') provider: string,
		@Query('state') state: string,
		@Query('code') code: string,
		@Query('error') error: string,
		@Req() req: Request,
		@Res() res: Response,
	) {
		res.setHeader('Cache-Control', 'no-store');
		res.setHeader('Referrer-Policy', 'no-referrer');
		try {
			await this.limits.consume('oauth-callback', req.ip ?? 'unknown', 60, 15 * 60000);
			const redirect = await this.social.callback(provider, state, code, !!error, req, res);
			return res.redirect(303, redirect);
		} catch {
			return res.redirect(303, this.social.redirect('/account/join', { authError: 'provider-failed' }));
		}
	}
	@Post('social/finish')
	async finish(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'social-finish', 30);
		return this.social.finishLogin(req, res);
	}
	@Get('social/onboarding')
	async onboarding(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'onboarding-read', 60);
		return this.social.onboardingInfo(req);
	}
	@Post('social/onboarding')
	async complete(@Body() body: OnboardingBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'onboarding-create');
		return this.social.completeOnboarding(req, res, body.memberNick, body.memberFullname);
	}
	@UseGuards(AuthGuard)
	@Get('security')
	status(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
		res.setHeader('Cache-Control', 'no-store');
		return this.security.status(req.authMember);
	}
	@UseGuards(AuthGuard)
	@Post('security/reauthenticate')
	async reauthenticate(@Body() body: PasswordBody, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'reauth');
		return this.security.reauthenticate(req.authMember, body.password);
	}
	@UseGuards(AuthGuard)
	@Delete('identities/:provider')
	async unlink(@Param('provider') value: string, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'unlink');
		const provider = value.toUpperCase() as Provider;
		if (!['GOOGLE', 'TELEGRAM', 'KAKAO'].includes(provider)) throw new BadRequestException('Invalid provider');
		return this.security.unlink(req.authMember, provider);
	}
	@UseGuards(AuthGuard)
	@Post('password/set')
	async setPassword(@Body() body: PasswordBody, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'password-set');
		return this.security.setPassword(req.authMember, body.password);
	}
	@UseGuards(AuthGuard)
	@Post('recovery-codes/generate')
	async codes(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'recovery-codes');
		return this.security.generateCodes(req.authMember);
	}
	@UseGuards(AuthGuard)
	@Post('email/verification/request')
	async requestEmail(@Body() body: EmailBody, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'verify-email', 5);
		return this.security.requestEmail(req.authMember, body.email);
	}
	@Post('email/verification/confirm')
	async confirmEmail(@Body() body: TokenBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'verify-confirm');
		return this.security.verifyEmail(body.token);
	}
	@Post('password/forgot')
	async forgot(@Body() body: ForgotBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'forgot', 5);
		return this.security.forgot(body.identifier);
	}
	@Post('password/reset')
	async reset(@Body() body: ResetBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'reset', 10);
		if (!!body.token === !!body.recoveryCode || (!!body.recoveryCode && !body.memberNick))
			throw new BadRequestException('Provide a reset link or your username and recovery code.');
		return this.security.reset(body);
	}
	@UseGuards(AuthGuard)
	@Post('sessions/revoke-others')
	async revokeOthers(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
		await this.browser(req, res, 'revoke-others');
		await this.sessions.assertRecent(req.authMember.sid, req.authMember.sub);
		await this.sessions.revokeAll(req.authMember.sub, req.authMember.sid);
		return { success: true };
	}
}
