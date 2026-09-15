import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsMongoId, IsString, Length } from 'class-validator';
import { ReviewStatus } from '../../enums/review.enum';

@InputType()
export class ReviewModerationInput {
	@IsMongoId()
	@Field(() => String)
	reviewId!: string;

	@IsEnum(ReviewStatus)
	@Field(() => ReviewStatus)
	reviewStatus!: ReviewStatus;

	@IsString()
	@Length(3, 500)
	@Field(() => String)
	moderationReason!: string;
}
