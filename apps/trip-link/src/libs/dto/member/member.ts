import { Field, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from 'mongoose';
import { MemberStatus, MemberType } from '../../enums/member.enum';

@ObjectType()
export class Member {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => MemberType)
	memberType!: MemberType;

	@Field(() => MemberStatus)
	memberStatus!: MemberStatus;

	@Field(() => String)
	memberNick!: string;

	@Field(() => String, { nullable: true })
	memberFullname?: string;

	@Field(() => String)
	memberImage!: string;

	@Field(() => String, { nullable: true })
	memberCountry?: string;

	@Field(() => String, { nullable: true })
	memberDesc?: string;

	@Field(() => [String])
	memberFavoriteDestinations!: string[];

	@Field(() => Int)
	memberTours!: number;

	@Field(() => Int)
	memberReviews!: number;

	@Field(() => Int)
	memberFollowers!: number;

	@Field(() => Int)
	memberFollowings!: number;

	@Field(() => Int)
	memberLikes!: number;

	@Field(() => Int)
	memberViews!: number;

	@Field(() => Int)
	memberComments!: number;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;
}

@ObjectType()
export class AuthPayload {
	@Field(() => String)
	accessToken!: string;

	@Field(() => Member)
	member!: Member;
}

@ObjectType()
export class TotalCounter {
	@Field(() => Int)
	total!: number;
}

@ObjectType()
export class Members {
	@Field(() => [Member])
	list!: Member[];

	@Field(() => [TotalCounter])
	metaCounter!: TotalCounter[];
}
