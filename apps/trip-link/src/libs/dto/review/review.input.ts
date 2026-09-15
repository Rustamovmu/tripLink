import { Type } from 'class-transformer';
import { Field, InputType, Int } from '@nestjs/graphql';
import {
	IsEnum,
	IsIn,
	IsInt,
	IsMongoId,
	IsNotEmpty,
	IsOptional,
	IsString,
	Length,
	Max,
	Min,
	ValidateNested,
} from 'class-validator';
import { availableReviewSorts } from '../../config';
import { Direction } from '../../enums/common.enum';
import { ReviewStatus } from '../../enums/review.enum';

@InputType()
export class ReviewInput {
	@IsMongoId()
	@Field(() => String)
	bookingId!: string;

	@IsInt()
	@Min(1)
	@Max(5)
	@Field(() => Int)
	reviewRating!: number;

	@IsString()
	@Length(3, 2000)
	@Field(() => String)
	reviewComment!: string;
}

@InputType()
export class TourReviewSearch {
	@IsMongoId()
	@Field(() => String)
	tourId!: string;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(5)
	@Field(() => Int, { nullable: true })
	reviewRating?: number;
}

@InputType()
export class TourReviewsInquiry {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(availableReviewSorts)
	@Field(() => String, { nullable: true })
	sort?: (typeof availableReviewSorts)[number];

	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => TourReviewSearch)
	@Field(() => TourReviewSearch)
	search!: TourReviewSearch;
}

@InputType()
export class AdminReviewSearch {
	@IsOptional()
	@IsEnum(ReviewStatus)
	@Field(() => ReviewStatus, { nullable: true })
	reviewStatus?: ReviewStatus;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(5)
	@Field(() => Int, { nullable: true })
	reviewRating?: number;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	bookingId?: string;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	userId?: string;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	agentId?: string;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	tourId?: string;
}

@InputType()
export class AllReviewsInquiry {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(availableReviewSorts)
	@Field(() => String, { nullable: true })
	sort?: (typeof availableReviewSorts)[number];

	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => AdminReviewSearch)
	@Field(() => AdminReviewSearch)
	search!: AdminReviewSearch;
}

@InputType()
export class MyReviewSearch {
	@IsOptional()
	@IsEnum(ReviewStatus)
	@Field(() => ReviewStatus, { nullable: true })
	reviewStatus?: ReviewStatus;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(5)
	@Field(() => Int, { nullable: true })
	reviewRating?: number;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	tourId?: string;
}

@InputType()
export class MyReviewsInquiry {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(availableReviewSorts)
	@Field(() => String, { nullable: true })
	sort?: (typeof availableReviewSorts)[number];

	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => MyReviewSearch)
	@Field(() => MyReviewSearch)
	search!: MyReviewSearch;
}
