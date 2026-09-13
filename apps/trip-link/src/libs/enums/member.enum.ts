import { registerEnumType } from '@nestjs/graphql';

export enum MemberType {
	ADMIN = 'ADMIN',
	USER = 'USER',
	AGENT = 'AGENT',
}

registerEnumType(MemberType, {
	name: 'MemberType',
});

export enum MemberStatus {
	PENDING = 'PENDING',
	ACTIVE = 'ACTIVE',
	BLOCK = 'BLOCK',
	SUSPENDED = 'SUSPENDED',
	DELETE = 'DELETE',
}

registerEnumType(MemberStatus, {
	name: 'MemberStatus',
});

export enum MemberAuthType {
	PHONE = 'PHONE',
	EMAIL = 'EMAIL',
	TELEGRAM = 'TELEGRAM',
}

registerEnumType(MemberAuthType, {
	name: 'MemberAuthType',
});

export enum AgentApprovalStatus {
	PENDING = 'PENDING',
	APPROVED = 'APPROVED',
	REJECTED = 'REJECTED',
	SUSPENDED = 'SUSPENDED',
}

registerEnumType(AgentApprovalStatus, {
	name: 'AgentApprovalStatus',
});
