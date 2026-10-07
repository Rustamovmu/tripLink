import { Transform } from 'class-transformer';
import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsMongoId, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { BoardArticleCategory, BoardArticleStatus } from '../../enums/board-article.enum';
import { articleImagePattern, trimArticleString } from './board-article.input';

@InputType()
export class BoardArticleUpdate {
	@IsMongoId()
	@Field(() => String)
	_id!: string;
	@IsOptional()
	@IsEnum(BoardArticleCategory)
	@Field(() => BoardArticleCategory, { nullable: true })
	articleCategory?: BoardArticleCategory;
	@IsOptional()
	@IsEnum(BoardArticleStatus)
	@Field(() => BoardArticleStatus, { nullable: true })
	articleStatus?: BoardArticleStatus;
	@ValidateIf((_object, value: unknown) => value !== undefined)
	@Transform(trimArticleString)
	@IsString()
	@Length(3, 50)
	@Field(() => String, { nullable: true })
	articleTitle?: string;
	@ValidateIf((_object, value: unknown) => value !== undefined)
	@Transform(trimArticleString)
	@IsString()
	@Length(3, 2000)
	@Field(() => String, { nullable: true })
	articleContent?: string;
	@ValidateIf((_object, value: unknown) => value !== undefined)
	@Transform(trimArticleString)
	@IsString()
	@Matches(articleImagePattern)
	@Field(() => String, { nullable: true })
	articleImage?: string;
}
