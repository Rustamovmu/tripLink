import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Member } from '../../libs/dto/member/member';
import { MemberType } from '../../libs/enums/member.enum';

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

@Injectable()
export class AuthService {
	constructor(private readonly jwtService: JwtService) {}

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

	public verifyToken(token: string): Promise<AuthTokenPayload> {
		return this.jwtService.verifyAsync<AuthTokenPayload>(token);
	}
}
