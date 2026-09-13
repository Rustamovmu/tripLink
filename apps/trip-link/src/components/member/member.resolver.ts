import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AgentsInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { AuthPayload, Member, Members } from '../../libs/dto/member/member';
import { MemberAdminUpdate, MemberUpdate } from '../../libs/dto/member/member.update';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthTokenPayload } from '../auth/auth.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
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
	@Mutation(() => AuthPayload)
	public updateMember(@Args('input') input: MemberUpdate, @AuthMember('sub') memberId: string): Promise<AuthPayload> {
		return this.memberService.updateMember(memberId, input);
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

	@UseGuards(WithoutGuard)
	@Query(() => Member)
	public getMember(@Args('memberId') memberId: string): Promise<Member> {
		return this.memberService.getMember(memberId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Members)
	public getAgents(@Args('input') input: AgentsInquiry): Promise<Members> {
		return this.memberService.getAgents(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Members)
	public getAllMembersByAdmin(@Args('input') input: MembersInquiry): Promise<Members> {
		return this.memberService.getAllMembersByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public updateMemberByAdmin(
		@Args('input') input: MemberAdminUpdate,
		@AuthMember('sub') adminId: string,
	): Promise<Member> {
		return this.memberService.updateMemberByAdmin(adminId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Member)
	public likeTargetMember(
		@Args('memberId') targetMemberId: string,
		@AuthMember('sub') memberId: string,
	): Promise<Member> {
		return this.memberService.likeTargetMember(memberId, targetMemberId);
	}
}
