import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { Model, Types } from 'mongoose';
import { AuthConfig } from './auth.config';
import { authFailure, TokenService } from './token.service';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';
export type SessionMember = {
	_id: string | Types.ObjectId;
	memberType: MemberType;
	memberNick: string;
	authVersion?: number;
};
export type SessionMetadata = { userAgent?: string };
export interface RefreshSession {
	_id: Types.ObjectId;
	memberId: Types.ObjectId;
	memberType: MemberType;
	authVersion: number;
	tokenHash: string;
	tokenId: string;
	tokenFamilyId: string;
	issuedAt: number;
	expiresAt: Date;
	absoluteExpiresAt: Date;
	revokedAt: Date | null;
	createdAt: Date;
	lastUsedAt: Date;
	lastAuthenticatedAt: Date;
	userAgent: string;
	deviceName: string;
	previousTokenHash?: string;
	rotationIdHash?: string;
	retryExpiresAt?: Date;
}
type Account = SessionMember & { memberStatus: MemberStatus };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const matches = (value: string | undefined, expected: string) =>
	!!value && value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
const secrets = '+tokenHash +tokenId +issuedAt +previousTokenHash +rotationIdHash +retryExpiresAt';
@Injectable()
export class AuthSessionService {
	constructor(
		@InjectModel('RefreshSession') private readonly sessions: Model<RefreshSession>,
		@InjectModel('Member') private readonly members: Model<Account>,
		private readonly tokens: TokenService,
		private readonly config: AuthConfig,
	) {}
	async create(member: SessionMember, metadata: SessionMetadata = {}) {
		const now = Math.floor(Date.now() / 1000);
		const id = new Types.ObjectId();
		const tokenId = randomUUID();
		const expiresAt = new Date((now + this.config.refreshSeconds) * 1000);
		const refreshToken = await this.tokens.refresh(
			String(member._id),
			id.toHexString(),
			now,
			expiresAt.getTime() / 1000,
			tokenId,
		);
		const userAgent = (metadata.userAgent ?? '')
			.slice(0, 300)
			.split('')
			.filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
			.join('');
		const deviceName = /iPhone|iPad/i.test(userAgent)
			? 'iPhone / iPad'
			: /Android/i.test(userAgent)
				? 'Android'
				: /Macintosh|Mac OS/i.test(userAgent)
					? 'Mac'
					: /Windows/i.test(userAgent)
						? 'Windows'
						: /Linux/i.test(userAgent)
							? 'Linux'
							: 'Browser';
		await this.sessions.create({
			_id: id,
			memberId: member._id,
			memberType: member.memberType,
			authVersion: member.authVersion ?? 0,
			tokenHash: hash(refreshToken),
			tokenId,
			tokenFamilyId: randomUUID(),
			issuedAt: now,
			expiresAt,
			absoluteExpiresAt: new Date((now + this.config.sessionSeconds) * 1000),
			lastUsedAt: new Date(now * 1000),
			lastAuthenticatedAt: new Date(now * 1000),
			userAgent,
			deviceName,
		});
		return {
			accessToken: await this.tokens.access(member, id.toHexString()),
			refreshToken,
			refreshExpiresAt: expiresAt,
		};
	}
	async retainVersion(sid: string, memberId: string, authVersion: number) {
		await this.sessions
			.updateOne({ _id: sid, memberId, revokedAt: null }, { $set: { authVersion, lastAuthenticatedAt: new Date() } })
			.exec();
	}

	async assertRecent(sid: string, memberId: string) {
		await this.assertActive(sid, memberId);
		const record = await this.sessions
			.findOne({ _id: sid, memberId })
			.select('lastAuthenticatedAt createdAt')
			.lean()
			.exec();
		if (!record || (record.lastAuthenticatedAt ?? record.createdAt).getTime() < Date.now() - 5 * 60000)
			throw new ForbiddenException({
				message: 'Please confirm your identity again to continue.',
				authCode: 'REAUTHENTICATION_REQUIRED',
			});
	}
	async markAuthenticated(sid: string, memberId: string) {
		await this.assertActive(sid, memberId);
		await this.sessions
			.updateOne({ _id: sid, memberId, revokedAt: null }, { $set: { lastAuthenticatedAt: new Date() } })
			.exec();
	}

	async assertActive(sid: string, memberId: string) {
		const session = await this.sessions
			.findOne({ _id: sid, memberId })
			.select('revokedAt expiresAt absoluteExpiresAt memberType authVersion')
			.lean<RefreshSession>()
			.exec();
		this.check(session);
		return session!;
	}
	private check(session: RefreshSession | null) {
		if (!session || session.revokedAt) throw authFailure('SESSION_REVOKED');
		if (session.absoluteExpiresAt.getTime() <= Date.now()) throw authFailure('SESSION_ABSOLUTE_EXPIRATION');
		if (session.expiresAt.getTime() <= Date.now()) throw authFailure('REFRESH_TOKEN_EXPIRED');
	}
	async rotate(raw: string, rotationId: string) {
		const claims = await this.tokens.verifyRefresh(raw);
		const session = await this.sessions
			.findOne({ _id: claims.sid, memberId: claims.sub })
			.select(secrets)
			.lean<RefreshSession>()
			.exec();
		this.check(session);
		const account = await this.members
			.findById(claims.sub)
			.select('_id memberStatus memberType memberNick +authVersion')
			.lean<Account>()
			.exec();
		if (
			!account ||
			account.memberStatus === MemberStatus.DELETE ||
			account.memberType !== session!.memberType ||
			(account.authVersion ?? 0) !== (session!.authVersion ?? 0)
		) {
			await this.revoke(claims.sid, claims.sub);
			throw authFailure('SESSION_REVOKED');
		}
		if (account.memberStatus !== MemberStatus.ACTIVE)
			throw new ForbiddenException({ message: Message.ACCOUNT_UNAVAILABLE, authCode: 'ACCOUNT_UNAVAILABLE' });
		const tokenHash = hash(raw),
			rotationIdHash = hash(rotationId);
		// A bounded retry of the SAME operation returns the SAME credential, never another rotation.
		// This handles a lost response/tab crash without granting a grace period to unrelated replay.
		const retry = (record: RefreshSession) =>
			record.retryExpiresAt &&
			record.retryExpiresAt.getTime() > Date.now() &&
			matches(record.rotationIdHash, rotationIdHash) &&
			(matches(record.previousTokenHash, tokenHash) || matches(record.tokenHash, tokenHash));
		if (retry(session!)) return this.grant(account, session!);
		if (!matches(session!.tokenHash, tokenHash)) {
			await this.revoke(claims.sid, claims.sub);
			throw authFailure('REFRESH_TOKEN_REUSED');
		}
		const now = Math.floor(Date.now() / 1000),
			tokenId = randomUUID();
		const expiresAt = new Date(
			Math.min(now + this.config.refreshSeconds, session!.absoluteExpiresAt.getTime() / 1000) * 1000,
		);
		const refreshToken = await this.tokens.refresh(claims.sub, claims.sid, now, expiresAt.getTime() / 1000, tokenId);
		const rotated = await this.sessions
			.findOneAndUpdate(
				{
					_id: claims.sid,
					memberId: claims.sub,
					tokenHash,
					revokedAt: null,
					expiresAt: { $gt: new Date(Date.now()) },
					absoluteExpiresAt: { $gt: new Date(Date.now()) },
				},
				{
					$set: {
						tokenHash: hash(refreshToken),
						previousTokenHash: tokenHash,
						rotationIdHash,
						retryExpiresAt: new Date(Date.now() + 30000),
						tokenId,
						issuedAt: now,
						expiresAt,
						lastUsedAt: new Date(Date.now()),
					},
				},
				{ new: true },
			)
			.select(secrets)
			.lean<RefreshSession>()
			.exec();
		if (rotated) return this.grant(account, rotated);
		const winner = await this.sessions.findById(claims.sid).select(secrets).lean<RefreshSession>().exec();
		this.check(winner);
		if (retry(winner!)) return this.grant(account, winner!);
		await this.revoke(claims.sid, claims.sub);
		throw authFailure('REFRESH_TOKEN_REUSED');
	}
	private async grant(member: Account, session: RefreshSession) {
		return {
			accessToken: await this.tokens.access(member, String(session._id)),
			refreshToken: await this.tokens.refresh(
				String(member._id),
				String(session._id),
				session.issuedAt,
				session.expiresAt.getTime() / 1000,
				session.tokenId,
			),
			refreshExpiresAt: session.expiresAt,
		};
	}
	async revoke(sid: string, memberId: string) {
		return this.sessions
			.updateOne({ _id: sid, memberId, revokedAt: null }, { $set: { revokedAt: new Date(Date.now()) } })
			.exec();
	}
	async revokeAll(memberId: string, exceptSid?: string) {
		await this.sessions
			.updateMany(
				{ memberId, revokedAt: null, ...(exceptSid ? { _id: { $ne: exceptSid } } : {}) },
				{ $set: { revokedAt: new Date(Date.now()) } },
			)
			.exec();
	}
	async list(memberId: string, sid: string) {
		const list = await this.sessions
			.find({
				memberId,
				revokedAt: null,
				expiresAt: { $gt: new Date(Date.now()) },
				absoluteExpiresAt: { $gt: new Date(Date.now()) },
			})
			.select('_id deviceName userAgent createdAt lastUsedAt expiresAt absoluteExpiresAt')
			.sort({ lastUsedAt: -1 })
			.lean<RefreshSession[]>()
			.exec();
		return list.map((s) => ({
			id: String(s._id),
			deviceName: s.deviceName,
			userAgent: s.userAgent,
			createdAt: s.createdAt,
			lastUsedAt: s.lastUsedAt,
			expiresAt: s.expiresAt,
			absoluteExpiresAt: s.absoluteExpiresAt,
			isCurrentSession: String(s._id) === sid,
		}));
	}
}
