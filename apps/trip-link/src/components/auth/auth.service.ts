import { ForbiddenException, Injectable } from '@nestjs/common';
import { authFailure, TokenService } from './token.service';
import { AuthSessionService, SessionMetadata } from './auth-session.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from '../../libs/enums/common.enum';
import * as bcrypt from 'bcryptjs';
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
};

type AuthMemberRecord = {
	_id: Types.ObjectId;
	memberImage?: string;
	memberStatus: MemberStatus;
	memberType: MemberType;
	memberNick: string;
};

@Injectable()
export class AuthService {
	constructor(
		private readonly tokens: TokenService,
		@InjectModel('Member') private readonly memberModel: Model<AuthMemberRecord>,
		private readonly sessions: AuthSessionService,
	) {}

	public async hashPassword(password: string): Promise<string> {
		const salt = await bcryptApi.genSalt(12);
		return bcryptApi.hash(password, salt);
	}

	public comparePasswords(password: string, hashedPassword: string): Promise<boolean> {
		return bcryptApi.compare(password, hashedPassword);
	}

	public issueSession(member: TokenMember, metadata: SessionMetadata = {}) {
		return this.sessions.create(
			{ ...member, _id: typeof member._id === 'string' ? member._id : member._id.toHexString() },
			metadata,
		);
	}
	public async createToken(member: TokenMember, sid?: string): Promise<string> {
		return sid ? this.tokens.access(member, sid) : (await this.issueSession(member)).accessToken;
	}
	public revokeOtherSessions(memberId: string, sid: string) {
		return this.sessions.revokeAll(memberId, sid);
	}

	public async verifyToken(
		token: string,
		includeMemberImage = false,
	): Promise<AuthTokenPayload & { memberImage?: string }> {
		const payload = await this.tokens.verifyAccess(token);
		await this.sessions.assertActive(payload.sid, payload.sub);

		// Do not catch database errors as authentication failures or cache account state across requests.
		const member = await this.memberModel
			.findById(payload.sub)
			.select(`_id memberStatus memberType memberNick${includeMemberImage ? ' memberImage' : ''}`)
			.lean<AuthMemberRecord>()
			.exec();
		if (!member || member.memberStatus === MemberStatus.DELETE || member.memberType !== payload.memberType) {
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
