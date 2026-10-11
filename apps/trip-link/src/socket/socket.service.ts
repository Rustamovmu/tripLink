import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { CHAT_HISTORY_LIMIT, CHAT_TYPING_EXPIRE_MS, CHAT_TYPING_THROTTLE_MS } from './socket.types';
import type { ChatClient, ChatMember, ChatMessage, SocketSession } from './socket.types';

@Injectable()
export class SocketService {
	private readonly sessions = new Map<WebSocket, SocketSession>();
	private readonly messages: ChatMessage[] = [];

	public register(client: WebSocket): SocketSession {
		const session: SocketSession = { pending: 0 };
		this.sessions.set(client, session);
		return session;
	}

	public getSession(client: WebSocket): SocketSession | undefined {
		return this.sessions.get(client);
	}

	public detach(client: WebSocket): ChatMember | undefined {
		const session = this.sessions.get(client);
		if (session?.authTimer) clearTimeout(session.authTimer);
		if (session?.typingTimer) clearTimeout(session.typingTimer);
		this.sessions.delete(client);
		return session?.member;
	}

	public authenticatedClients(): ChatClient[] {
		return [...this.sessions.entries()].filter(
			([client, session]) => client.readyState === WebSocket.OPEN && !!session.member,
		);
	}

	public totalClients(): number {
		return this.authenticatedClients().length;
	}

	public presence() {
		const clients = this.authenticatedClients();
		const list = [...new Map(clients.map(([, session]) => [session.member!._id, { ...session.member! }])).values()];
		list.sort((a, b) => a.memberNick.localeCompare(b.memberNick) || a._id.localeCompare(b._id));
		return { list, totalMembers: list.length, totalClients: clients.length };
	}

	public isTyping(memberId: string, now = Date.now()): boolean {
		return this.authenticatedClients().some(
			([, session]) => session.member!._id === memberId && (session.typingUntil ?? 0) > now,
		);
	}

	public setTyping(client: WebSocket, isTyping: boolean, now = Date.now()): boolean {
		const session = this.sessions.get(client);
		if (!session?.member) return false;
		if (isTyping && session.lastTypingAt !== undefined && now - session.lastTypingAt < CHAT_TYPING_THROTTLE_MS)
			return false;
		if (!isTyping && !session.typingUntil) return false;
		if (session.typingTimer) clearTimeout(session.typingTimer);
		session.typingTimer = undefined;
		session.typingUntil = isTyping ? now + CHAT_TYPING_EXPIRE_MS : undefined;
		if (isTyping) session.lastTypingAt = now;
		return true;
	}

	public addMessage(text: string, member: ChatMember): ChatMessage {
		const message: ChatMessage = {
			_id: randomUUID(),
			text,
			createdAt: new Date().toISOString(),
			memberData: { ...member },
		};
		this.messages.push(message);
		if (this.messages.length > CHAT_HISTORY_LIMIT) this.messages.splice(0, this.messages.length - CHAT_HISTORY_LIMIT);
		return { ...message, memberData: { ...message.memberData } };
	}

	public history(): ChatMessage[] {
		return this.messages.map((message) => ({ ...message, memberData: { ...message.memberData } }));
	}

	public shutdown(): void {
		for (const client of this.sessions.keys()) {
			this.detach(client);
			client.terminate();
		}
		this.messages.length = 0;
	}
}
