import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AgentToursInquiry, AllToursInquiry, TourInput, ToursInquiry } from '../../libs/dto/tour/tour.input';
import { Tour, Tours } from '../../libs/dto/tour/tour';
import { TourUpdate } from '../../libs/dto/tour/tour.update';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
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

	@Query(() => Tour)
	public getTour(@Args('tourId') tourId: string): Promise<Tour> {
		return this.tourService.getTour(tourId);
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
}
