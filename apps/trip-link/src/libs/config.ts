import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

export const availableAgentSorts = [
	'createdAt',
	'updatedAt',
	'memberFollowers',
	'memberTours',
	'memberReviews',
	'memberViews',
] as const;

export const availableMemberSorts = [
	'createdAt',
	'updatedAt',
	'memberNick',
	'memberType',
	'memberStatus',
	'memberBookings',
	'memberWarnings',
] as const;

export const availableTourSorts = [
	'createdAt',
	'updatedAt',
	'tourPrice',
	'tourDurationDays',
	'tourAverageRating',
	'tourBookingCount',
	'tourViewCount',
	'tourFavoriteCount',
] as const;

export const availableBookingSorts = ['createdAt', 'updatedAt', 'selectedDate', 'totalPrice'] as const;

/** IMAGE CONFIGURATION **/

export const uploadTargets = ['member', 'tour', 'article'] as const;
export type UploadTarget = (typeof uploadTargets)[number];
export type ImageExtension = '.png' | '.jpg';

export const uploadRoot = path.resolve(process.cwd(), 'uploads');

export const isUploadTarget = (target: string): target is UploadTarget =>
	uploadTargets.includes(target as UploadTarget);

export const getSerialForImage = (extension: ImageExtension): string => `${randomUUID()}${extension}`;
