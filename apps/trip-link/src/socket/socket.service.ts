import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
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

	public addMessage(text: string, member: ChatMember): ChatMessage {
		const message: ChatMessage = {
			_id: randomUUID(),
			text,
			createdAt: new Date().toISOString(),
			memberData: { ...member },
		};
		this.messages.push(message);
		if (this.messages.length > 5) this.messages.splice(0, this.messages.length - 5);
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
