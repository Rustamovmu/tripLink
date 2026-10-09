import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsMongoId, IsOptional, IsString, Length } from 'class-validator';
import { FaqTopic, NoticeStatus } from '../../enums/notice.enum';
import { helpStatuses, trimHelpText } from './help-center.input';
@InputType()
export class HelpEntryUpdate {
	@IsMongoId() @Field(() => String) entryId!: string;
	@Transform(trimHelpText)
	@IsOptional()
	@IsString()
	@Length(3, 150)
	@Field(() => String, { nullable: true })
	noticeTitle?: string;
	@Transform(trimHelpText)
	@IsOptional()
	@IsString()
	@Length(3, 10000)
	@Field(() => String, { nullable: true })
	noticeContent?: string;
	@IsOptional() @IsEnum(FaqTopic) @Field(() => FaqTopic, { nullable: true }) faqTopic?: FaqTopic;
	@IsOptional() @IsIn(helpStatuses) @Field(() => NoticeStatus, { nullable: true }) noticeStatus?: NoticeStatus;
}
