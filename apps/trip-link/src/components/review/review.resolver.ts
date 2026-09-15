import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
	AllReviewsInquiry,
	MyReviewsInquiry,
	ReviewInput,
	TourReviewsInquiry,
} from '../../libs/dto/review/review.input';
import { ReviewModerationInput } from '../../libs/dto/review/review.moderation';
import { Review, Reviews } from '../../libs/dto/review/review';
import { ReviewUpdate } from '../../libs/dto/review/review.update';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
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

	@UseGuards(WithoutGuard)
	@Query(() => Reviews)
	public getTourReviews(@Args('input') input: TourReviewsInquiry): Promise<Reviews> {
		return this.reviewService.getTourReviews(input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Review)
	public updateReview(@Args('input') input: ReviewUpdate, @AuthMember('sub') userId: string): Promise<Review> {
		return this.reviewService.updateReview(userId, input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Review)
	public removeReview(@Args('reviewId') reviewId: string, @AuthMember('sub') userId: string): Promise<Review> {
		return this.reviewService.removeReview(userId, reviewId);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Review)
	public moderateReviewByAdmin(@Args('input') input: ReviewModerationInput): Promise<Review> {
		return this.reviewService.moderateReviewByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Reviews)
	public getAllReviewsByAdmin(@Args('input') input: AllReviewsInquiry): Promise<Reviews> {
		return this.reviewService.getAllReviewsByAdmin(input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Query(() => Reviews)
	public getMyReviews(@Args('input') input: MyReviewsInquiry, @AuthMember('sub') userId: string): Promise<Reviews> {
		return this.reviewService.getMyReviews(userId, input);
	}
}
