import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Request, Response } from 'express';
import { AuthConfig } from './auth.config';
import { AuthService, AuthTokenPayload } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { TokenService } from './token.service';
import { AuthRecordsService, randomSecret, Provider, digest } from './auth-records.service';
import { OidcProviderService, VerifiedIdentity } from './oidc-provider.service';
import { AccountSecurityService, SecurityMember } from './account-security.service';
import { AuthCookieService } from './auth-cookie.service';
import { normalizeUsername, safeAuthReturn } from './account-policy';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
export type OAuthIntent = 'LOGIN' | 'LINK' | 'REAUTH';
interface OAuthFlow {
	provider: Provider;
	nonce: string;
	verifier: string;
	intent: OAuthIntent;
	memberId?: string;
	sid?: string;
	returnTo: string;
}
interface Onboarding {
	identity: VerifiedIdentity;
	returnTo: string;
}
@Injectable()
export class SocialAuthService {
	constructor(
		private readonly providers: OidcProviderService,
		private readonly records: AuthRecordsService,
		private readonly security: AccountSecurityService,
		private readonly auth: AuthService,
		private readonly sessions: AuthSessionService,
		private readonly tokens: TokenService,
		private readonly cookies: AuthCookieService,
		private readonly config: AuthConfig,
		@InjectModel('Member') private readonly members: Model<SecurityMember>,
	) {}
	private cookieName(kind: 'flow' | 'onboarding' | 'login') {
		return `${this.config.secure ? '__Secure-' : ''}triplink_${kind}`;
	}
	private cookiePath(kind: 'flow' | 'onboarding' | 'login') {
		return kind === 'flow' ? '/auth/oauth' : '/auth/social';
	}
	private read(req: Request, kind: 'flow' | 'onboarding' | 'login') {
		const name = this.cookieName(kind);
		const raw = req.headers.cookie
			?.split(';')
			.map((v) => v.trim())
			.find((v) => v.startsWith(name + '='))
			?.slice(name.length + 1);
		return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : '';
	}
	private set(res: Response, kind: 'flow' | 'onboarding' | 'login', raw: string) {
		res.cookie(this.cookieName(kind), raw, {
			path: this.cookiePath(kind),
			httpOnly: true,
			secure: this.config.secure,
			sameSite: kind === 'flow' ? 'lax' : this.config.sameSite,
			maxAge: 10 * 60000,
		});
		res.setHeader('Cache-Control', 'no-store');
		res.setHeader('Referrer-Policy', 'no-referrer');
	}
	private clear(res: Response, kind: 'flow' | 'onboarding' | 'login') {
		res.clearCookie(this.cookieName(kind), {
			path: this.cookiePath(kind),
			httpOnly: true,
			secure: this.config.secure,
			sameSite: kind === 'flow' ? 'lax' : this.config.sameSite,
		});
	}
	async start(
		value: string,
		intent: OAuthIntent,
		returnTo: string,
		req: Request,
		res: Response,
		actor?: AuthTokenPayload,
	) {
		const provider = this.providers.get(value);
		if (intent !== 'LOGIN') {
			if (!actor) throw new UnauthorizedException('Sign in before connecting an account.');
			if (intent === 'LINK') await this.sessions.assertRecent(actor.sid, actor.sub);
		}
		const binding = randomSecret(),
			nonce = randomSecret(),
			verifier = randomSecret();
		const state = await this.records.create(
			'OAUTH',
			{
				provider: provider.provider,
				nonce,
				verifier,
				intent,
				returnTo: safeAuthReturn(returnTo),
				...(actor ? { memberId: actor.sub, sid: actor.sid } : {}),
			} satisfies OAuthFlow,
			10,
			binding,
		);
		this.set(res, 'flow', binding);
		return { authorizationUrl: this.providers.authorization(provider, state, nonce, verifier, intent === 'REAUTH') };
	}
	private async currentFlowActor(req: Request, flow: OAuthFlow) {
		const claims = await this.tokens.verifyRefresh(this.cookies.read(req));
		if (claims.sid !== flow.sid || claims.sub !== flow.memberId)
			throw new UnauthorizedException('The account changed during authentication. Please try again.');
		const session = await this.sessions.assertActive(claims.sid, claims.sub);
		const member = await this.members
			.findOne({ _id: claims.sub, memberStatus: MemberStatus.ACTIVE })
			.select('+authVersion')
			.lean()
			.exec();
		if (!member || member.memberType !== session.memberType || (member.authVersion ?? 0) !== (session.authVersion ?? 0))
			throw new UnauthorizedException('Sign in again to continue.');
		return member;
	}
	async callback(value: string, state: string, code: string, cancelled: boolean, req: Request, res: Response) {
		const binding = this.read(req, 'flow');
		if (!binding) throw new UnauthorizedException('This sign-in request has expired. Please try again.');
		const flow = await this.records.consume<OAuthFlow>(state, 'OAUTH', binding);
		this.clear(res, 'flow');
		const provider = this.providers.get(value);
		if (provider.provider !== flow.provider)
			throw new BadRequestException('This provider does not match the sign-in request.');
		if (cancelled) return this.redirect('/account/join', { authError: 'cancelled', referrer: flow.returnTo });
		const identity = await this.providers.exchange(provider, code, flow.nonce, flow.verifier);
		if (flow.intent !== 'LOGIN') {
			await this.currentFlowActor(req, flow);
			if (flow.intent === 'REAUTH') {
				const linked = await this.records.identities.exists({
					memberId: flow.memberId,
					provider: identity.provider,
					providerUserId: identity.subject,
				});
				if (!linked) throw new UnauthorizedException('Use a connected provider to confirm your identity.');
				await this.sessions.markAuthenticated(flow.sid!, flow.memberId!);
				await this.records.event(flow.memberId, 'REAUTHENTICATED', identity.provider);
			} else {
				await this.sessions.assertRecent(flow.sid!, flow.memberId!);
				try {
					await this.security.transaction(async (session) => {
						await this.records.serialize(flow.memberId!, session);
						await this.records.identities.create(
							[{ memberId: flow.memberId, provider: identity.provider, providerUserId: identity.subject }],
							{ session },
						);
						await this.records.event(flow.memberId, 'PROVIDER_CONNECTED', identity.provider, session);
					});
				} catch (error: unknown) {
					if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
						throw new ConflictException('This provider account is already connected.');
					throw error;
				}
			}
			return this.redirect('/account/complete', { security: '1' });
		}
		const linked = await this.records.identities
			.findOne({ provider: identity.provider, providerUserId: identity.subject })
			.lean()
			.exec();
		if (linked) {
			const member = await this.members
				.findOne({ _id: linked.memberId, memberStatus: MemberStatus.ACTIVE })
				.select('+authVersion')
				.lean()
				.exec();
			if (!member) throw new UnauthorizedException('This account is not available.');
			const pending = await this.records.create(
				'SOCIAL_LOGIN',
				{ identity, memberId: String(member._id), authVersion: member.authVersion ?? 0, returnTo: flow.returnTo },
				2,
			);
			this.set(res, 'login', pending);
			return this.redirect('/account/complete', {});
		}
		// Matching email never establishes ownership or links accounts. Even a verified provider email
		// is not installed as a recovery address without the member's explicit email-verification flow.
		if (identity.email) {
			const conflict = await this.members.exists({ memberEmail: identity.email.trim().toLowerCase() });
			const recoveryConflict = await this.records.security.exists({
				recoveryEmail: identity.email.trim().toLowerCase(),
			});
			if (conflict || recoveryConflict)
				return this.redirect('/account/join', { authError: 'link-required', referrer: flow.returnTo });
		}
		const pending = await this.records.create(
			'ONBOARDING',
			{ identity, returnTo: flow.returnTo } satisfies Onboarding,
			10,
		);
		this.set(res, 'onboarding', pending);
		return this.redirect('/account/onboarding', {});
	}
	redirect(path: string, query: Record<string, string>) {
		const url = new URL(path, this.providers.frontend);
		url.search = new URLSearchParams(query).toString();
		return url.toString();
	}
	async onboardingInfo(req: Request) {
		const raw = this.read(req, 'onboarding');
		if (!raw) throw new UnauthorizedException('Sign in with your provider again to continue.');
		const record = await this.records.transactions
			.findOne({ _id: digest(raw), kind: 'ONBOARDING', consumedAt: null, expiresAt: { $gt: new Date() } })
			.select('+sealed')
			.lean()
			.exec();
		if (!record) throw new UnauthorizedException('Sign in with your provider again to continue.');
		const data = this.records.open<Onboarding>(record.sealed);
		return { provider: data.identity.provider, suggestedName: data.identity.name ?? '' };
	}
	private publicMember(memberId: string) {
		return this.members
			.findById(memberId)
			.select(
				'_id memberType memberStatus memberNick memberFullname memberImage memberCountry memberDesc memberFavoriteDestinations memberTours memberReviews memberFollowers memberFollowings memberLikes memberViews memberComments agentRank createdAt updatedAt',
			)
			.lean()
			.exec();
	}
	async finishLogin(req: Request, res: Response) {
		const data = await this.records.consume<Onboarding & { memberId: string; authVersion: number }>(
			this.read(req, 'login'),
			'SOCIAL_LOGIN',
		);
		const linked = await this.records.identities.exists({
			memberId: data.memberId,
			provider: data.identity.provider,
			providerUserId: data.identity.subject,
		});
		const member = await this.members
			.findOne({ _id: data.memberId, memberStatus: MemberStatus.ACTIVE })
			.select('+authVersion')
			.lean()
			.exec();
		if (!linked || !member || (member.authVersion ?? 0) !== data.authVersion)
			throw new UnauthorizedException('Sign in with your provider again to continue.');
		const payload = await this.auth.issueSession(member, { userAgent: req.headers['user-agent'] });
		this.cookies.set(res, payload);
		this.clear(res, 'login');
		await this.records.identities
			.updateOne({ memberId: member._id, provider: data.identity.provider }, { $set: { lastUsedAt: new Date() } })
			.exec();
		return {
			accessToken: payload.accessToken,
			member: await this.publicMember(data.memberId),
			returnTo: safeAuthReturn(data.returnTo),
		};
	}

	async completeOnboarding(req: Request, res: Response, username: string, fullname?: string) {
		const nick = normalizeUsername(username),
			raw = this.read(req, 'onboarding');
		let returnTo = '/';
		const member = await this.security
			.transaction(async (session) => {
				const data = await this.records.consume<Onboarding>(raw, 'ONBOARDING', undefined, session);
				returnTo = data.returnTo;
				// Both member creation and identity ownership are atomic. A repeated provider signup rolls
				// back its member if another request already created the authoritative identity.
				const [created] = await this.members.create(
					[
						{
							memberNick: nick,
							memberType: MemberType.USER,
							memberStatus: MemberStatus.ACTIVE,
							...(fullname ? { memberFullname: fullname.trim() } : {}),
						},
					],
					{ session },
				);
				await this.records.identities.create(
					[{ memberId: created._id, provider: data.identity.provider, providerUserId: data.identity.subject }],
					{ session },
				);
				await this.records.event(String(created._id), 'SOCIAL_ACCOUNT_CREATED', data.identity.provider, session);
				return created;
			})
			.catch((error: unknown) => {
				if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
					throw new ConflictException(
						'This username or provider account is already in use. Try another username or sign in again.',
					);
				throw error;
			});
		const payload = await this.auth.issueSession(member, { userAgent: req.headers['user-agent'] });
		this.cookies.set(res, payload);
		this.clear(res, 'onboarding');
		return {
			accessToken: payload.accessToken,
			member: await this.publicMember(String(member._id)),
			returnTo: safeAuthReturn(returnTo),
		};
	}
}
