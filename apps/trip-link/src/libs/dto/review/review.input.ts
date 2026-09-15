import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsMongoId, IsString, Length, Max, Min } from 'class-validator';

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
