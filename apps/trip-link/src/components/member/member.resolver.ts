import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { LoginInput, MemberInput } from '../../libs/dto/member/member.input';
import { AuthPayload } from '../../libs/dto/member/member';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
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
}
