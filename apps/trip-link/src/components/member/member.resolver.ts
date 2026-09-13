import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { LoginInput, MemberInput } from '../../libs/dto/member/member.input';
import { AuthPayload } from '../../libs/dto/member/member';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthTokenPayload } from '../auth/auth.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MemberService } from './member.service';

@Resolver()
export class MemberResolver {
	constructor(private readonly memberService: MemberService) {}

	@Mutation(() => AuthPayload)
	public signup(@Args('input') input: MemberInput): Promise<AuthPayload> {
		return this.memberService.signup(input);
	}

	@Mutation(() => AuthPayload)
	public login(@Args('input') input: LoginInput): Promise<AuthPayload> {
		return this.memberService.login(input);
	}

	@UseGuards(AuthGuard)
	@Query(() => String)
	public checkAuth(@AuthMember('memberNick') memberNick: string): string {
		return `Hi ${memberNick}`;
	}

	@Roles(MemberType.USER, MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Query(() => String)
	public checkAuthRoles(@AuthMember() authMember: AuthTokenPayload): string {
		return `Hi ${authMember.memberNick}, you are ${authMember.memberType} (memberId: ${authMember.sub})`;
	}
}
