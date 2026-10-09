import { registerEnumType } from '@nestjs/graphql';

export enum NoticeCategory {
	FAQ = 'FAQ',
	NOTICE = 'NOTICE',
	TERMS = 'TERMS',
	INQUIRY = 'INQUIRY',
}
registerEnumType(NoticeCategory, {
	name: 'NoticeCategory',
});

export enum NoticeStatus {
	HOLD = 'HOLD',
	ACTIVE = 'ACTIVE',
	DELETE = 'DELETE',
}
registerEnumType(NoticeStatus, {
	name: 'NoticeStatus',
});

export enum FaqTopic {
	TOURS = 'TOURS',
	BOOKINGS = 'BOOKINGS',
	PAYMENTS = 'PAYMENTS',
	ACCOUNTS = 'ACCOUNTS',
	AGENTS = 'AGENTS',
	COMMUNITY = 'COMMUNITY',
	OTHER = 'OTHER',
}
registerEnumType(FaqTopic, { name: 'FaqTopic' });
