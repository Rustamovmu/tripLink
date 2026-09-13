import * as path from 'path';
import * as uuidPackage from 'uuid';

const uuidv4 = (uuidPackage as unknown as { v4: () => string }).v4;

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

/** IMAGE CONFIGURATION **/

export const validMimeTypes = ['image/png', 'image/jpg', 'image/jpeg'];

export const getSerialForImage = (filename: string): string => {
	const extension = path.parse(filename).ext;
	return uuidv4() + extension;
};
