import { Field, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from 'mongoose';
import { ReviewStatus } from '../../enums/review.enum';
import { Member, TotalCounter } from '../member/member';

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

	@Field(() => String, { nullable: true })
	moderationReason?: string;

	@Field(() => Date, { nullable: true })
	moderatedAt?: Date;

	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	@Field(() => Member, { nullable: true })
	userData?: Member;
}

@ObjectType()
export class Reviews {
	@Field(() => [Review])
	list!: Review[];

	@Field(() => [TotalCounter])
	metaCounter!: TotalCounter[];
}
