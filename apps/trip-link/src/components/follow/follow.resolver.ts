import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { FollowToggleResult } from '../../libs/dto/follow/follow';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FollowService } from './follow.service';

@Resolver()
export class FollowResolver {
	constructor(private readonly followService: FollowService) {}

	@Roles(MemberType.USER, MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Mutation(() => FollowToggleResult)
	public toggleFollowMember(
		@Args('memberId') followingId: string,
		@AuthMember('sub') followerId: string,
	): Promise<FollowToggleResult> {
		return this.followService.toggleFollowMember(followerId, followingId);
	}
}
