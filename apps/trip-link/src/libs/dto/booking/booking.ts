import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from 'mongoose';
import { BookingStatus, PaymentStatus } from '../../enums/booking.enum';
import { Member, TotalCounter } from '../member/member';
import { Tour } from '../tour/tour';

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

	@Field(() => Date, { nullable: true })
	selectedEndDate?: Date;

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
	paymentReference?: string;

	@Field(() => Date, { nullable: true })
	paidAt?: Date;

	@Field(() => String, { nullable: true })
	refundReference?: string;

	@Field(() => String, { nullable: true })
	refundReason?: string;

	@Field(() => Date, { nullable: true })
	refundedAt?: Date;

	@Field(() => String, { nullable: true })
	cancellationReason?: string;

	@Field(() => Date, { nullable: true })
	cancelledAt?: Date;

	@Field(() => String, { nullable: true })
	rejectionReason?: string;

	@Field(() => Date, { nullable: true })
	rejectedAt?: Date;

	@Field(() => Date, { nullable: true })
	completedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	@Field(() => Tour, { nullable: true })
	tourData?: Tour;

	@Field(() => Member, { nullable: true })
	agentData?: Member;

	@Field(() => Member, { nullable: true })
	userData?: Member;
}

@ObjectType()
export class Bookings {
	@Field(() => [Booking])
	list!: Booking[];

	@Field(() => [TotalCounter])
	metaCounter!: TotalCounter[];
}
