import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Message } from '../../libs/enums/common.enum';
import * as bcrypt from 'bcryptjs';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';

export interface AuthTokenPayload {
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
	memberStatus: MemberStatus;
	memberType: MemberType;
	memberNick: string;
};

@Injectable()
export class AuthService {
	constructor(
		private readonly jwtService: JwtService,
		@InjectModel('Member') private readonly memberModel: Model<AuthMemberRecord>,
	) {}

	public async hashPassword(password: string): Promise<string> {
		const salt = await bcryptApi.genSalt(12);
		return bcryptApi.hash(password, salt);
	}

	public comparePasswords(password: string, hashedPassword: string): Promise<boolean> {
		return bcryptApi.compare(password, hashedPassword);
	}

	public createToken(member: TokenMember): Promise<string> {
		const memberId = typeof member._id === 'string' ? member._id : member._id.toHexString();
		const payload: AuthTokenPayload = {
			sub: memberId,
			memberType: member.memberType,
			memberNick: member.memberNick,
		};

		return this.jwtService.signAsync(payload);
	}

	public async verifyToken(token: string): Promise<AuthTokenPayload> {
		let payload: AuthTokenPayload;
		try {
			payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token);
		} catch {
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}
		if (
			!payload ||
			typeof payload.sub !== 'string' ||
			!isValidObjectId(payload.sub) ||
			!Object.values(MemberType).includes(payload.memberType)
		) {
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}

		// Do not catch database errors as authentication failures or cache account state across requests.
		const member = await this.memberModel
			.findById(payload.sub)
			.select('_id memberStatus memberType memberNick')
			.lean<AuthMemberRecord>()
			.exec();
		if (!member || member.memberStatus === MemberStatus.DELETE || member.memberType !== payload.memberType) {
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}
		if (member.memberStatus !== MemberStatus.ACTIVE) {
			throw new ForbiddenException(Message.ACCOUNT_UNAVAILABLE);
		}
		return { ...payload, sub: member._id.toHexString(), memberType: member.memberType, memberNick: member.memberNick };
	}
}
