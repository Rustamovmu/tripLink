import { Field, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from 'mongoose';
import { ReviewStatus } from '../../enums/review.enum';

@ObjectType()
export class Review {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	bookingId!: ObjectId;

	@Field(() => String)
	userId!: ObjectId;

	@Field(() => String)
	tourId!: ObjectId;

	@Field(() => String)
	agentId!: ObjectId;

	@Field(() => Int)
	reviewRating!: number;

	@Field(() => String)
	reviewComment!: string;

	@Field(() => ReviewStatus)
	reviewStatus!: ReviewStatus;

	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;
}
