import { registerEnumType } from '@nestjs/graphql';

export enum MessageStatus {
	SENT = 'SENT',
	READ = 'READ',
	DELETE = 'DELETE',
}
registerEnumType(MessageStatus, {
	name: 'MessageStatus',
});
