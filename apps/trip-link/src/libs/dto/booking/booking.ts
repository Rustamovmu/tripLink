import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from 'mongoose';
import { BookingStatus, PaymentStatus } from '../../enums/booking.enum';

@ObjectType()
export class Booking {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	bookingCode!: string;

	@Field(() => String)
	userId!: ObjectId;

	@Field(() => String)
	tourId!: ObjectId;

	@Field(() => String)
	agentId!: ObjectId;

	@Field(() => String)
	tourDateId!: ObjectId;

	@Field(() => Date)
	selectedDate!: Date;

	@Field(() => Int)
	numberOfPeople!: number;

	@Field(() => Float)
	unitPrice!: number;

	@Field(() => Float)
	totalPrice!: number;

	@Field(() => BookingStatus)
	bookingStatus!: BookingStatus;

	@Field(() => PaymentStatus)
	paymentStatus!: PaymentStatus;

	@Field(() => String, { nullable: true })
	cancellationReason?: string;

	@Field(() => Date, { nullable: true })
	cancelledAt?: Date;

	@Field(() => Date, { nullable: true })
	completedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;
}
