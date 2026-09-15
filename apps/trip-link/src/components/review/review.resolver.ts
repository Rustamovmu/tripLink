import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { ReviewInput } from '../../libs/dto/review/review.input';
import { Review } from '../../libs/dto/review/review';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReviewService } from './review.service';

@Resolver()
export class ReviewResolver {
	constructor(private readonly reviewService: ReviewService) {}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Review)
	public createReview(@Args('input') input: ReviewInput, @AuthMember('sub') userId: string): Promise<Review> {
		return this.reviewService.createReview(userId, input);
	}
}
