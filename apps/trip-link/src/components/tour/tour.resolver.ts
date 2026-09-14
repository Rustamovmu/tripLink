import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
	AgentToursInquiry,
	AllToursInquiry,
	FavoriteToursInquiry,
	TourInput,
	ToursInquiry,
	VisitedToursInquiry,
} from '../../libs/dto/tour/tour.input';
import { FavoriteToggleResult, Tour, Tours } from '../../libs/dto/tour/tour';
import { TourAdminUpdate, TourUpdate } from '../../libs/dto/tour/tour.update';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthTokenPayload } from '../auth/auth.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { TourService } from './tour.service';

@Resolver()
export class TourResolver {
	constructor(private readonly tourService: TourService) {}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Mutation(() => Tour)
	public createTour(@Args('input') input: TourInput, @AuthMember('sub') agentId: string): Promise<Tour> {
		return this.tourService.createTour(agentId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Tour)
	public getTour(@Args('tourId') tourId: string, @AuthMember() authMember: AuthTokenPayload | null): Promise<Tour> {
		const viewerId = authMember?.memberType === MemberType.USER ? authMember.sub : null;
		return this.tourService.getTour(tourId, viewerId);
	}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Mutation(() => Tour)
	public updateTour(@Args('input') input: TourUpdate, @AuthMember('sub') agentId: string): Promise<Tour> {
		return this.tourService.updateTour(agentId, input);
	}

	@Query(() => Tours)
	public getTours(@Args('input') input: ToursInquiry): Promise<Tours> {
		return this.tourService.getTours(input);
	}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Query(() => Tours)
	public getAgentTours(@Args('input') input: AgentToursInquiry, @AuthMember('sub') agentId: string): Promise<Tours> {
		return this.tourService.getAgentTours(agentId, input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Tours)
	public getAllToursByAdmin(@Args('input') input: AllToursInquiry): Promise<Tours> {
		return this.tourService.getAllToursByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Tour)
	public updateTourByAdmin(@Args('input') input: TourAdminUpdate): Promise<Tour> {
		return this.tourService.updateTourByAdmin(input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => FavoriteToggleResult)
	public toggleFavoriteTour(
		@Args('tourId') tourId: string,
		@AuthMember('sub') memberId: string,
	): Promise<FavoriteToggleResult> {
		return this.tourService.toggleFavoriteTour(memberId, tourId);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Query(() => Tours)
	public getFavoriteTours(
		@Args('input') input: FavoriteToursInquiry,
		@AuthMember('sub') memberId: string,
	): Promise<Tours> {
		return this.tourService.getFavoriteTours(memberId, input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Query(() => Tours)
	public getVisitedTours(
		@Args('input') input: VisitedToursInquiry,
		@AuthMember('sub') memberId: string,
	): Promise<Tours> {
		return this.tourService.getVisitedTours(memberId, input);
	}
}
