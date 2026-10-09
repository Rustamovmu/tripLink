import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { HelpEntry, HelpEntries } from '../../libs/dto/help-center/help-center';
import {
	HelpEntryInput,
	HelpEntriesInquiry,
	AdminHelpEntriesInquiry,
} from '../../libs/dto/help-center/help-center.input';
import { HelpEntryUpdate } from '../../libs/dto/help-center/help-center.update';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { HelpCenterService } from './help-center.service';
@Resolver()
export class HelpCenterResolver {
	constructor(private readonly help: HelpCenterService) {}
	@UseGuards(WithoutGuard)
	@Query(() => HelpEntries)
	getHelpEntries(@Args('input') input: HelpEntriesInquiry): Promise<HelpEntries> {
		return this.help.list(input);
	}
	@UseGuards(WithoutGuard)
	@Query(() => HelpEntry)
	getHelpEntry(@Args('entryId') entryId: string): Promise<HelpEntry> {
		return this.help.get(entryId);
	}
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => HelpEntries)
	getAllHelpEntriesByAdmin(@Args('input') input: AdminHelpEntriesInquiry): Promise<HelpEntries> {
		return this.help.list(input, true);
	}
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => HelpEntry)
	createHelpEntry(@Args('input') input: HelpEntryInput, @AuthMember('sub') memberId: string): Promise<HelpEntry> {
		return this.help.create(memberId, input);
	}
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => HelpEntry)
	updateHelpEntry(@Args('input') input: HelpEntryUpdate): Promise<HelpEntry> {
		return this.help.update(input);
	}
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Boolean)
	removeHelpEntry(@Args('entryId') entryId: string): Promise<boolean> {
		return this.help.remove(entryId);
	}
}
