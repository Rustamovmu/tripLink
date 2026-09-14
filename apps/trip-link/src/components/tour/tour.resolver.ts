import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { TourInput } from '../../libs/dto/tour/tour.input';
import { Tour } from '../../libs/dto/tour/tour';
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
}
