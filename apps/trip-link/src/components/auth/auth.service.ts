import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { AuthRecordsService } from './auth-records.service';
import { authFailure, TokenService } from './token.service';
import { AuthSessionService, SessionMetadata } from './auth-session.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from '../../libs/enums/common.enum';
import * as bcrypt from 'bcryptjs';
import * as argon2 from 'argon2';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';

export interface AuthTokenPayload {
	sid: string;
	type: 'access';
	sub: string;
	memberType: MemberType;
	memberNick: string;
	iat?: number;
	exp?: number;
}

interface BcryptApi {
	genSalt(rounds: number): Promise<string>;
	hash(password: string, salt: string): Promise<string>;
	compare(password: string, hashedPassword: string): Promise<boolean>;
}

const bcryptApi = bcrypt as unknown as BcryptApi;

type TokenMember = Pick<Member, 'memberType' | 'memberNick'> & {
	_id: string | { toHexString(): string };
	authVersion?: number;
};

type AuthMemberRecord = {
	_id: Types.ObjectId;
	memberImage?: string;
	memberStatus: MemberStatus;
	memberType: MemberType;
	memberNick: string;
	authVersion?: number;
};

@Injectable()
export class AuthService {
	constructor(
		private readonly tokens: TokenService,
		@InjectModel('Member') private readonly memberModel: Model<AuthMemberRecord>,
		private readonly sessions: AuthSessionService,
		@Optional() private readonly records?: AuthRecordsService,
	) {}

	public async hashPassword(password: string): Promise<string> {
		return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
	}

	private static dummyHash: Promise<string> | undefined;
	public async verifyAbsentCredential(password: string) {
		AuthService.dummyHash ??= this.hashPassword('TripLink invalid credentials dummy passphrase');
		await this.comparePasswords(password, await AuthService.dummyHash);
	}

	public comparePasswords(password: string, hashedPassword: string): Promise<boolean> {
		return hashedPassword.startsWith('$argon2id$')
			? argon2.verify(hashedPassword, password)
			: bcryptApi.compare(password, hashedPassword);
	}

	public async issueSession(member: TokenMember, metadata: SessionMetadata = {}) {
		const payload = await this.sessions.create(
			{
				_id: typeof member._id === 'string' ? member._id : member._id.toHexString(),
				memberType: member.memberType,
				memberNick: member.memberNick,
				authVersion: member.authVersion ?? 0,
			},
			metadata,
		);
		await this.records?.event(typeof member._id === 'string' ? member._id : member._id.toHexString(), 'SIGNED_IN');
		return payload;
	}
	public async createToken(member: TokenMember, sid?: string): Promise<string> {
		return sid ? this.tokens.access(member, sid) : (await this.issueSession(member)).accessToken;
	}
	public async revokeOtherSessions(memberId: string, sid: string) {
		await this.records?.event(memberId, 'PASSWORD_CHANGED');
		return this.sessions.revokeAll(memberId, sid);
	}

	public retainSessionVersion(sid: string, memberId: string, authVersion: number) {
		return this.sessions.retainVersion(sid, memberId, authVersion);
	}

	public async verifyToken(
		token: string,
		includeMemberImage = false,
	): Promise<AuthTokenPayload & { memberImage?: string }> {
		const payload = await this.tokens.verifyAccess(token);
		const session = await this.sessions.assertActive(payload.sid, payload.sub);

		// Do not catch database errors as authentication failures or cache account state across requests.
		const member = await this.memberModel
			.findById(payload.sub)
			.select(`_id memberStatus memberType memberNick +authVersion${includeMemberImage ? ' memberImage' : ''}`)
			.lean<AuthMemberRecord>()
			.exec();
		if (
			!member ||
			member.memberStatus === MemberStatus.DELETE ||
			member.memberType !== payload.memberType ||
			(member.authVersion ?? 0) !== (session.authVersion ?? 0)
		) {
			throw authFailure('UNAUTHORIZED');
		}
		if (member.memberStatus !== MemberStatus.ACTIVE) {
			throw new ForbiddenException({ message: Message.ACCOUNT_UNAVAILABLE, authCode: 'ACCOUNT_UNAVAILABLE' });
		}
		return {
			...payload,
			sub: member._id.toHexString(),
			memberType: member.memberType,
			memberNick: member.memberNick,
			// Chat photos come from the current account, never from client commands or JWT image claims.
			...(includeMemberImage ? { memberImage: typeof member.memberImage === 'string' ? member.memberImage : '' } : {}),
		};
	}
}
