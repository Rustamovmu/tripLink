import type WebSocket from 'ws';
import type { MemberType } from '../libs/enums/member.enum';

export const CHAT_AUTH_TIMEOUT_MS = 10000;
export const CHAT_MAX_PAYLOAD_BYTES = 8192;
export const CHAT_MAX_QUEUED_COMMANDS = 20;
export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_TYPING_THROTTLE_MS = 2000;
export const CHAT_TYPING_EXPIRE_MS = 5000;

export interface ChatMember {
	_id: string;
	memberNick: string;
	memberImage?: string;
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
	typingUntil?: number;
	lastTypingAt?: number;
	typingTimer?: ReturnType<typeof setTimeout>;
}

export type ChatErrorCode =
	| 'ACCESS_TOKEN_EXPIRED'
	| 'BAD_REQUEST'
	| 'UNAUTHENTICATED'
	| 'FORBIDDEN'
	| 'INTERNAL_SERVER_ERROR'
	| 'TOO_MANY_REQUESTS';

export type ChatResponse =
	| { event: 'authenticated'; data: { memberData: ChatMember; totalClients: number } }
	| { event: 'presence'; data: { list: ChatMember[]; totalMembers: number; totalClients: number } }
	| { event: 'typing'; data: { memberData: ChatMember; isTyping: boolean } }
	| { event: 'message'; data: ChatMessage }
	| { event: 'getMessages'; data: { list: ChatMessage[] } }
	| { event: 'info'; data: { action: 'joined' | 'left'; memberData: ChatMember; totalClients: number } }
	| { event: 'error'; data: { code: ChatErrorCode; message: string } };

export type ChatClient = [WebSocket, SocketSession];
