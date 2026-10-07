import { Field, ObjectType } from '@nestjs/graphql';
import type { Types } from 'mongoose';
import { CommentGroup, CommentStatus } from '../../enums/comment.enum';
import { Member, TotalCounter } from '../member/member';

@ObjectType()
export class Comment {
	@Field(() => String) _id!: Types.ObjectId;
	@Field(() => CommentStatus) commentStatus!: CommentStatus;
	@Field(() => CommentGroup) commentGroup!: CommentGroup;
	@Field(() => String) commentContent!: string;
	@Field(() => String) commentRefId!: Types.ObjectId;
	@Field(() => String) memberId!: Types.ObjectId;
	@Field(() => Date) createdAt!: Date;
	@Field(() => Date) updatedAt!: Date;
	@Field(() => Member, { nullable: true }) memberData?: Member;
}
@ObjectType()
export class Comments {
	@Field(() => [Comment]) list!: Comment[];
	@Field(() => [TotalCounter]) metaCounter!: TotalCounter[];
}
