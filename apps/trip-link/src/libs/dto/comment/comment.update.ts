import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsEnum, IsMongoId, IsString, Length, ValidateIf } from 'class-validator';
import { CommentStatus } from '../../enums/comment.enum';
import { trimComment } from './comment.input';

@InputType()
export class CommentUpdate {
	@IsMongoId() @Field(() => String) _id!: string;
	@ValidateIf((_object, value: unknown) => value !== undefined)
	@Transform(trimComment)
	@IsString()
	@Length(1, 100)
	@Field(() => String, { nullable: true })
	commentContent?: string;
	@ValidateIf((_object, value: unknown) => value !== undefined)
	@IsEnum(CommentStatus)
	@Field(() => CommentStatus, { nullable: true })
	commentStatus?: CommentStatus;
}
