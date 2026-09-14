import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsMongoId, Max, Min } from 'class-validator';

@InputType()
export class BookingInput {
	@IsMongoId()
	@Field(() => String)
	tourId!: string;

	@IsMongoId()
	@Field(() => String)
	tourDateId!: string;

	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	numberOfPeople!: number;
}
