import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsMongoId, IsString, Length, Max, Min } from 'class-validator';

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

@InputType()
export class BookingCancellationInput {
	@IsMongoId()
	@Field(() => String)
	bookingId!: string;

	@IsString()
	@Length(3, 500)
	@Field(() => String)
	cancellationReason!: string;
}
