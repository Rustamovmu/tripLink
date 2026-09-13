import { registerEnumType } from '@nestjs/graphql';

export enum NotificationType {
	BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
	BOOKING_CANCELLED = 'BOOKING_CANCELLED',
	NEW_MESSAGE = 'NEW_MESSAGE',
	NEW_FOLLOWER = 'NEW_FOLLOWER',
	NEW_REVIEW = 'NEW_REVIEW',
	TOUR_UPDATED = 'TOUR_UPDATED',
}
registerEnumType(NotificationType, {
	name: 'NotificationType',
});

export enum NotificationStatus {
	WAIT = 'WAIT',
	READ = 'READ',
}
registerEnumType(NotificationStatus, {
	name: 'NotificationStatus',
});

export enum NotificationGroup {
	MEMBER = 'MEMBER',
	TOUR = 'TOUR',
	BOOKING = 'BOOKING',
	MESSAGE = 'MESSAGE',
	REVIEW = 'REVIEW',
	FOLLOW = 'FOLLOW',
}
registerEnumType(NotificationGroup, {
	name: 'NotificationGroup',
});
