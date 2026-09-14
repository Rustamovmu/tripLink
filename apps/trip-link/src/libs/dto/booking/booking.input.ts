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
import { availableBookingSorts } from '../../config';
import { BookingStatus, PaymentStatus } from '../../enums/booking.enum';
import { Direction } from '../../enums/common.enum';

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

@InputType()
export class BookingSearch {
	@IsOptional()
	@IsEnum(BookingStatus)
	@Field(() => BookingStatus, { nullable: true })
	bookingStatus?: BookingStatus;

	@IsOptional()
	@IsEnum(PaymentStatus)
	@Field(() => PaymentStatus, { nullable: true })
	paymentStatus?: PaymentStatus;
}

@InputType()
export class MyBookingsInquiry {
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
	@IsIn(availableBookingSorts)
	@Field(() => String, { nullable: true })
	sort?: (typeof availableBookingSorts)[number];

	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => BookingSearch)
	@Field(() => BookingSearch)
	search!: BookingSearch;
}

@InputType()
export class AgentBookingSearch {
	@IsOptional()
	@IsEnum(BookingStatus)
	@Field(() => BookingStatus, { nullable: true })
	bookingStatus?: BookingStatus;

	@IsOptional()
	@IsEnum(PaymentStatus)
	@Field(() => PaymentStatus, { nullable: true })
	paymentStatus?: PaymentStatus;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	tourId?: string;
}

@InputType()
export class AgentBookingsInquiry {
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
	@IsIn(availableBookingSorts)
	@Field(() => String, { nullable: true })
	sort?: (typeof availableBookingSorts)[number];

	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => AgentBookingSearch)
	@Field(() => AgentBookingSearch)
	search!: AgentBookingSearch;
}
