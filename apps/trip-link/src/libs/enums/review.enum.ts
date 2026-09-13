import { registerEnumType } from '@nestjs/graphql';

export enum ReviewStatus {
	ACTIVE = 'ACTIVE',
	HIDDEN = 'HIDDEN',
	DELETE = 'DELETE',
}
registerEnumType(ReviewStatus, {
	name: 'ReviewStatus',
});
