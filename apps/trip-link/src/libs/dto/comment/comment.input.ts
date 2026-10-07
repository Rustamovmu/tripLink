import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
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
import { CommentStatus } from '../../enums/comment.enum';
import { Direction } from '../../enums/common.enum';

export const trimComment = ({ value }: { value: unknown }): unknown =>
	typeof value === 'string' ? value.trim() : value;
export const commentSorts = ['createdAt', 'updatedAt'] as const;
@InputType()
export class CommentInput {
	@IsMongoId() @Field(() => String) commentRefId!: string;
	@Transform(trimComment) @IsString() @Length(1, 100) @Field(() => String) commentContent!: string;
}
@InputType()
export class CommentSearch {
	@IsMongoId() @Field(() => String) commentRefId!: string;
}
@InputType()
export class AdminCommentSearch extends CommentSearch {
	@IsOptional() @IsEnum(CommentStatus) @Field(() => CommentStatus, { nullable: true }) commentStatus?: CommentStatus;
}
@InputType({ isAbstract: true })
class CommentPagination {
	@IsInt() @Min(1) @Field(() => Int) page!: number;
	@IsInt() @Min(1) @Max(100) @Field(() => Int) limit!: number;
	@IsOptional() @IsIn(commentSorts) @Field(() => String, { nullable: true }) sort?: (typeof commentSorts)[number];
	@IsOptional() @IsEnum(Direction) @Field(() => Direction, { nullable: true }) direction?: Direction;
}
@InputType()
export class CommentsInquiry extends CommentPagination {
	@IsNotEmpty() @ValidateNested() @Type(() => CommentSearch) @Field(() => CommentSearch) search!: CommentSearch;
}
@InputType()
export class AllCommentsInquiry extends CommentPagination {
	@IsNotEmpty()
	@ValidateNested()
	@Type(() => AdminCommentSearch)
	@Field(() => AdminCommentSearch)
	search!: AdminCommentSearch;
}
