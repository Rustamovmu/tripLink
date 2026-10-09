import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import {
	IsEnum,
	IsIn,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Length,
	Max,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';
import { FaqTopic, NoticeCategory, NoticeStatus } from '../../enums/notice.enum';
export const helpKinds = [NoticeCategory.FAQ, NoticeCategory.NOTICE];
export const helpStatuses = [NoticeStatus.HOLD, NoticeStatus.ACTIVE];
export const trimHelpText = ({ value }: { value: unknown }): unknown =>
	typeof value === 'string' ? value.trim() : value;
@InputType()
export class HelpEntryInput {
	@IsIn(helpKinds) @Field(() => NoticeCategory) noticeCategory!: NoticeCategory;
	@Transform(trimHelpText) @IsString() @Length(3, 150) @Field(() => String) noticeTitle!: string;
	@Transform(trimHelpText) @IsString() @Length(3, 10000) @Field(() => String) noticeContent!: string;
	@IsOptional() @IsEnum(FaqTopic) @Field(() => FaqTopic, { nullable: true }) faqTopic?: FaqTopic;
	@IsOptional() @IsIn(helpStatuses) @Field(() => NoticeStatus, { nullable: true }) noticeStatus?: NoticeStatus;
}
@InputType()
export class HelpSearch {
	@IsOptional() @IsIn(helpKinds) @Field(() => NoticeCategory, { nullable: true }) noticeCategory?: NoticeCategory;
	@IsOptional() @IsEnum(FaqTopic) @Field(() => FaqTopic, { nullable: true }) faqTopic?: FaqTopic;
	@Transform(trimHelpText)
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Field(() => String, { nullable: true })
	text?: string;
}
@InputType()
export class AdminHelpSearch extends HelpSearch {
	@IsOptional() @IsIn(helpStatuses) @Field(() => NoticeStatus, { nullable: true }) noticeStatus?: NoticeStatus;
}
@InputType({ isAbstract: true })
class HelpPagination {
	@IsInt() @Min(1) @Field(() => Int) page!: number;
	@IsInt() @Min(1) @Max(100) @Field(() => Int) limit!: number;
}
@InputType()
export class HelpEntriesInquiry extends HelpPagination {
	@IsNotEmpty() @ValidateNested() @Type(() => HelpSearch) @Field(() => HelpSearch) search!: HelpSearch;
}
@InputType()
export class AdminHelpEntriesInquiry extends HelpPagination {
	@IsNotEmpty() @ValidateNested() @Type(() => AdminHelpSearch) @Field(() => AdminHelpSearch) search!: AdminHelpSearch;
}
