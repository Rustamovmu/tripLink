import type WebSocket from 'ws';
import type { MemberType } from '../libs/enums/member.enum';

export const CHAT_AUTH_TIMEOUT_MS = 10000;
export const CHAT_MAX_PAYLOAD_BYTES = 8192;
export const CHAT_MAX_QUEUED_COMMANDS = 20;

export interface ChatMember {
	_id: string;
	memberNick: string;
	memberType: MemberType;
}

export interface ChatMessage {
	_id: string;
	text: string;
	createdAt: string;
	memberData: ChatMember;
}

export interface SocketSession {
	token?: string;
	member?: ChatMember;
	authTimer?: ReturnType<typeof setTimeout>;
	pending: number;
}

export type ChatErrorCode =
	'BAD_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR' | 'TOO_MANY_REQUESTS';

export type ChatResponse =
	| { event: 'authenticated'; data: { memberData: ChatMember; totalClients: number } }
	| { event: 'message'; data: ChatMessage }
	| { event: 'getMessages'; data: { list: ChatMessage[] } }
	| { event: 'info'; data: { action: 'joined' | 'left'; memberData: ChatMember; totalClients: number } }
	| { event: 'error'; data: { code: ChatErrorCode; message: string } };

export type ChatClient = [WebSocket, SocketSession];
