import { Field, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from 'mongoose';
import { Member, TotalCounter } from '../member/member';

@ObjectType()
export class FollowToggleResult {
	@Field(() => Member)
	member!: Member;

	@Field(() => Boolean)
	followed!: boolean;
}

@ObjectType()
export class FollowMember {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	followingId!: ObjectId;

	@Field(() => String)
	followerId!: ObjectId;

	@Field(() => Date)
	followedAt!: Date;

	@Field(() => Member)
	memberData!: Member;

	@Field(() => Boolean)
	isFollowing!: boolean;
}

@ObjectType()
export class FollowMembers {
	@Field(() => [FollowMember])
	list!: FollowMember[];

	@Field(() => [TotalCounter])
	metaCounter!: TotalCounter[];
}
