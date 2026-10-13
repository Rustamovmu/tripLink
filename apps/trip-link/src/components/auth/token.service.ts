import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { isValidObjectId } from 'mongoose';
import { AuthConfig } from './auth.config';
import { MemberType } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';
export interface AccessClaims {
	sub: string;
	sid: string;
	type: 'access';
	memberType: MemberType;
	memberNick: string;
	iat?: number;
	exp?: number;
}
export interface RefreshClaims {
	sub: string;
	sid: string;
	type: 'refresh';
	jti: string;
	iat: number;
	exp: number;
}
export const authFailure = (code: string) =>
	new UnauthorizedException({ message: Message.NOT_AUTHENTICATED, authCode: code });
@Injectable()
export class TokenService {
	constructor(
		private readonly jwt: JwtService,
		private readonly config: AuthConfig,
	) {}
	access(member: { _id: string | { toHexString(): string }; memberType: MemberType; memberNick: string }, sid: string) {
		return this.jwt.signAsync(
			{
				sub: typeof member._id === 'string' ? member._id : member._id.toHexString(),
				sid,
				type: 'access',
				memberType: member.memberType,
				memberNick: member.memberNick,
			},
			{
				secret: this.config.accessSecret,
				algorithm: 'HS256',
				expiresIn: this.config.accessSeconds,
				issuer: this.config.issuer,
				audience: this.config.audience,
			},
		);
	}
	refresh(sub: string, sid: string, issuedAt: number, expiresAt: number, jti: string = randomUUID()) {
		const claims: RefreshClaims = { sub, sid, type: 'refresh', jti, iat: issuedAt, exp: expiresAt };
		return this.jwt.signAsync(claims, {
			secret: this.config.refreshSecret,
			algorithm: 'HS256',
			issuer: this.config.issuer,
			audience: this.config.audience,
		});
	}
	async verifyAccess(token: string): Promise<AccessClaims> {
		let claims: AccessClaims;
		try {
			claims = await this.jwt.verifyAsync<AccessClaims>(token, {
				secret: this.config.accessSecret,
				algorithms: ['HS256'],
				issuer: this.config.issuer,
				audience: this.config.audience,
			});
		} catch (error: unknown) {
			throw authFailure(
				error instanceof Error && error.name === 'TokenExpiredError' ? 'ACCESS_TOKEN_EXPIRED' : 'UNAUTHORIZED',
			);
		}
		if (
			claims.type !== 'access' ||
			!isValidObjectId(claims.sub) ||
			!isValidObjectId(claims.sid) ||
			!Object.values(MemberType).includes(claims.memberType) ||
			typeof claims.exp !== 'number' ||
			typeof claims.iat !== 'number'
		)
			throw authFailure('UNAUTHORIZED');
		return claims;
	}
	async verifyRefresh(token: string): Promise<RefreshClaims> {
		let claims: RefreshClaims;
		try {
			claims = await this.jwt.verifyAsync<RefreshClaims>(token, {
				secret: this.config.refreshSecret,
				algorithms: ['HS256'],
				issuer: this.config.issuer,
				audience: this.config.audience,
			});
		} catch (error: unknown) {
			throw authFailure(
				error instanceof Error && error.name === 'TokenExpiredError' ? 'REFRESH_TOKEN_EXPIRED' : 'UNAUTHORIZED',
			);
		}
		if (
			claims.type !== 'refresh' ||
			!isValidObjectId(claims.sub) ||
			!isValidObjectId(claims.sid) ||
			typeof claims.jti !== 'string' ||
			!/^[a-f0-9-]{36}$/.test(claims.jti) ||
			typeof claims.exp !== 'number' ||
			typeof claims.iat !== 'number'
		)
			throw authFailure('UNAUTHORIZED');
		return claims;
	}
}
