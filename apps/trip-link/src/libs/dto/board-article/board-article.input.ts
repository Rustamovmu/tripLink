import { Transform, Type } from 'class-transformer';
import { Field, InputType, Int } from '@nestjs/graphql';
import {
	IsEnum,
	IsIn,
	IsInt,
	IsMongoId,
	IsNotEmpty,
	IsOptional,
	IsString,
	Length,
	Matches,
	Max,
	Min,
	ValidateNested,
} from 'class-validator';
import { availableBoardArticleSorts } from '../../config';
import { BoardArticleCategory, BoardArticleStatus } from '../../enums/board-article.enum';
import { Direction } from '../../enums/common.enum';

export const trimArticleString = ({ value }: { value: unknown }): unknown =>
	typeof value === 'string' ? value.trim() : value;
export const articleImagePattern = /^uploads\/article\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)$/;

@InputType()
export class BoardArticleInput {
	@IsEnum(BoardArticleCategory)
	@Field(() => BoardArticleCategory)
	articleCategory!: BoardArticleCategory;
	@Transform(trimArticleString)
	@IsString()
	@Length(3, 50)
	@Field(() => String)
	articleTitle!: string;
	@Transform(trimArticleString)
	@IsString()
	@Length(3, 2000)
	@Field(() => String)
	articleContent!: string;
	@IsOptional()
	@Transform(trimArticleString)
	@IsString()
	@Matches(articleImagePattern)
	@Field(() => String, { nullable: true })
	articleImage?: string;
}

@InputType()
export class BoardArticleSearch {
	@IsOptional()
	@IsEnum(BoardArticleCategory)
	@Field(() => BoardArticleCategory, { nullable: true })
	articleCategory?: BoardArticleCategory;
	@IsOptional()
	@Transform(trimArticleString)
	@IsString()
	@Length(1, 100)
	@Field(() => String, { nullable: true })
	text?: string;
	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	memberId?: string;
}

@InputType()
export class AdminBoardArticleSearch extends BoardArticleSearch {
	@IsOptional()
	@IsEnum(BoardArticleStatus)
	@Field(() => BoardArticleStatus, { nullable: true })
	articleStatus?: BoardArticleStatus;
}

@InputType({ isAbstract: true })
class ArticlePagination {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	page!: number;
	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	limit!: number;
	@IsOptional()
	@IsIn(availableBoardArticleSorts)
	@Field(() => String, { nullable: true })
	sort?: (typeof availableBoardArticleSorts)[number];
	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;
}

@InputType()
export class BoardArticlesInquiry extends ArticlePagination {
	@IsNotEmpty()
	@ValidateNested()
	@Type(() => BoardArticleSearch)
	@Field(() => BoardArticleSearch)
	search!: BoardArticleSearch;
}

@InputType()
export class AllBoardArticlesInquiry extends ArticlePagination {
	@IsNotEmpty()
	@ValidateNested()
	@Type(() => AdminBoardArticleSearch)
	@Field(() => AdminBoardArticleSearch)
	search!: AdminBoardArticleSearch;
}
