import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { MemberInput } from '../../libs/dto/member/member.input';
import { AuthPayload } from '../../libs/dto/member/member';
import { MemberService } from './member.service';

@Resolver()
export class MemberResolver {
	constructor(private readonly memberService: MemberService) {}

	@Mutation(() => AuthPayload)
	public signup(@Args('input') input: MemberInput): Promise<AuthPayload> {
		return this.memberService.signup(input);
	}
}
