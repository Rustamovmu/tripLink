import { registerEnumType } from '@nestjs/graphql';

export enum ConversationStatus {
	ACTIVE = 'ACTIVE',
	ARCHIVED = 'ARCHIVED',
	BLOCKED = 'BLOCKED',
}
registerEnumType(ConversationStatus, {
	name: 'ConversationStatus',
});
