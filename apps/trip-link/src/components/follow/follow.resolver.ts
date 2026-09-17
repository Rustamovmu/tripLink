import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { FollowInquiry } from '../../libs/dto/follow/follow.input';
import { FollowMembers, FollowToggleResult } from '../../libs/dto/follow/follow';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthTokenPayload } from '../auth/auth.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
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

	@UseGuards(WithoutGuard)
	@Query(() => FollowMembers)
	public getMemberFollowers(
		@Args('input') input: FollowInquiry,
		@AuthMember() authMember: AuthTokenPayload | null,
	): Promise<FollowMembers> {
		return this.followService.getMemberFollowers(this.getViewerId(authMember), input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => FollowMembers)
	public getMemberFollowings(
		@Args('input') input: FollowInquiry,
		@AuthMember() authMember: AuthTokenPayload | null,
	): Promise<FollowMembers> {
		return this.followService.getMemberFollowings(this.getViewerId(authMember), input);
	}

	private getViewerId(authMember: AuthTokenPayload | null): string | null {
		if (!authMember || ![MemberType.USER, MemberType.AGENT].includes(authMember.memberType)) return null;
		return authMember.sub;
	}
}
