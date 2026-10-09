import { Field, ObjectType } from '@nestjs/graphql';
import { FaqTopic, NoticeCategory, NoticeStatus } from '../../enums/notice.enum';
import { TotalCounter } from '../member/member';

@ObjectType()
export class HelpEntry {
	@Field(() => String) _id!: string;
	@Field(() => NoticeCategory) noticeCategory!: NoticeCategory;
	@Field(() => NoticeStatus) noticeStatus!: NoticeStatus;
	@Field(() => FaqTopic, { nullable: true }) faqTopic?: FaqTopic;
	@Field(() => String) noticeTitle!: string;
	@Field(() => String) noticeContent!: string;
	@Field(() => String) memberId!: string;
	@Field(() => Date) createdAt!: Date;
	@Field(() => Date) updatedAt!: Date;
}
@ObjectType()
export class HelpEntries {
	@Field(() => [HelpEntry]) list!: HelpEntry[];
	@Field(() => [TotalCounter]) metaCounter!: TotalCounter[];
}
