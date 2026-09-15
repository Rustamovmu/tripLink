import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsMongoId, IsOptional, IsString, Length, Max, Min } from 'class-validator';

@InputType()
export class ReviewUpdate {
	@IsMongoId()
	@Field(() => String)
	reviewId!: string;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(5)
	@Field(() => Int, { nullable: true })
	reviewRating?: number;

	@IsOptional()
	@IsString()
	@Length(3, 2000)
	@Field(() => String, { nullable: true })
	reviewComment?: string;
}
