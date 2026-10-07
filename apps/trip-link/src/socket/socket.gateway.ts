import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	OnModuleDestroy,
	UnauthorizedException,
} from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import WebSocket, { type RawData } from 'ws';
import { AuthService } from '../components/auth/auth.service';
import { SocketService } from './socket.service';
import { CHAT_AUTH_TIMEOUT_MS, CHAT_MAX_PAYLOAD_BYTES, CHAT_MAX_QUEUED_COMMANDS } from './socket.types';
import type { ChatClient, ChatErrorCode, ChatMember, ChatResponse, SocketSession } from './socket.types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

@Injectable()
@WebSocketGateway({ path: '/chat', maxPayload: CHAT_MAX_PAYLOAD_BYTES })
export class SocketGateway implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>, OnModuleDestroy {
	private roomQueue: Promise<void> = Promise.resolve();
	private stopping = false;

	constructor(
		private readonly auth: AuthService,
		private readonly chat: SocketService,
	) {}

	public handleConnection(client: WebSocket): void {
		if (this.stopping) {
			client.close(1001, 'Server shutting down');
			return;
		}
		const session = this.chat.register(client);
		session.authTimer = setTimeout(
			() => this.reject(client, 'UNAUTHENTICATED', 'Authentication timed out', 1008),
			CHAT_AUTH_TIMEOUT_MS,
		);
		// Handle raw frames explicitly: the default WsAdapter silently ignores malformed JSON and unknown events.
		client.on('message', (raw: RawData, binary: boolean) => this.receive(client, raw, binary));
	}

	public handleDisconnect(client: WebSocket): void {
		const member = this.chat.detach(client);
		if (member) this.announceLeave(member);
	}

	public onModuleDestroy(): void {
		this.stopping = true;
		this.chat.shutdown();
	}

	private receive(client: WebSocket, raw: RawData, binary: boolean): void {
		const session = this.chat.getSession(client);
		if (!session || this.stopping) return;
		if (session.pending >= CHAT_MAX_QUEUED_COMMANDS) {
			this.reject(client, 'TOO_MANY_REQUESTS', 'Too many queued commands', 1013);
			return;
		}
		// Retain at most 20 small frames per connection; process commands in room order.
		session.pending++;
		this.enqueue(async () => {
			try {
				if (!this.current(client, session)) return;
				if (binary) throw new BadRequestException('Binary messages are not supported');
				const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
				if (bytes.length > CHAT_MAX_PAYLOAD_BYTES) {
					this.reject(client, 'BAD_REQUEST', 'Frame too large', 1009);
					return;
				}
				let command: unknown;
				try {
					command = JSON.parse(bytes.toString('utf8')) as unknown;
				} catch {
					throw new BadRequestException('Invalid JSON');
				}
				await this.command(client, session, command);
			} catch (error: unknown) {
				this.handleFailure(client, error);
			} finally {
				session.pending--;
			}
		});
	}

	private async command(client: WebSocket, session: SocketSession, command: unknown): Promise<void> {
		if (
			!isRecord(command) ||
			typeof command.event !== 'string' ||
			Object.keys(command).some((key) => !['event', 'data'].includes(key))
		)
			throw new BadRequestException('Invalid command');
		if (session.member) {
			if (!session.token) throw new UnauthorizedException();
			session.member = await this.verify(session.token);
			if (!this.current(client, session)) return;
		}
		if (command.event === 'authenticate') {
			if (session.member) throw new BadRequestException('Already authenticated');
			if (
				!isRecord(command.data) ||
				typeof command.data.token !== 'string' ||
				!command.data.token.trim() ||
				Object.keys(command.data).some((key) => key !== 'token')
			)
				throw new UnauthorizedException();
			const token = command.data.token.trim();
			const member = await this.verify(token);
			if (!this.current(client, session)) return;
			session.token = token;
			session.member = member;
			if (session.authTimer) clearTimeout(session.authTimer);
			const recipients = await this.validRecipients();
			if (!this.current(client, session)) return;
			this.send(client, {
				event: 'authenticated',
				data: { memberData: session.member, totalClients: this.chat.totalClients() },
			});
			this.send(client, { event: 'getMessages', data: { list: this.chat.history() } });
			this.broadcast(recipients, {
				event: 'info',
				data: { action: 'joined', memberData: session.member, totalClients: this.chat.totalClients() },
			});
			return;
		}
		if (!session.member || !session.token) throw new UnauthorizedException();
		if (command.event === 'getMessages') {
			if (!isRecord(command.data) || Object.keys(command.data).length)
				throw new BadRequestException('getMessages requires empty data');
			this.send(client, { event: 'getMessages', data: { list: this.chat.history() } });
			return;
		}
		if (command.event !== 'message') throw new BadRequestException('Unknown event');
		if (typeof command.data !== 'string' || command.data.trim().length < 1 || command.data.trim().length > 1000)
			throw new BadRequestException('Message must contain 1–1000 characters');
		const recipients = await this.validRecipients();
		if (!this.current(client, session)) return;
		const message = this.chat.addMessage(command.data.trim(), session.member);
		this.broadcast(recipients, { event: 'message', data: message });
	}

	private async verify(token: string): Promise<ChatMember> {
		const member = await this.auth.verifyToken(token);
		return { _id: member.sub, memberNick: member.memberNick, memberType: member.memberType };
	}

	private async validRecipients(): Promise<ChatClient[]> {
		const valid: ChatClient[] = [];
		for (const [client, session] of this.chat.authenticatedClients()) {
			try {
				session.member = await this.verify(session.token!);
				if (this.current(client, session)) valid.push([client, session]);
			} catch (error: unknown) {
				this.handleFailure(client, error);
			}
		}
		return valid;
	}

	private current(client: WebSocket, session: SocketSession): boolean {
		return !this.stopping && client.readyState === WebSocket.OPEN && this.chat.getSession(client) === session;
	}

	private send(client: WebSocket, response: ChatResponse): void {
		if (client.readyState !== WebSocket.OPEN) return;
		try {
			client.send(JSON.stringify(response), (error?: Error) => {
				if (error) client.terminate();
			});
		} catch {
			client.terminate();
		}
	}

	private broadcast(recipients: ChatClient[], response: ChatResponse): void {
		for (const [client, session] of recipients) if (this.current(client, session)) this.send(client, response);
	}

	private reject(client: WebSocket, code: ChatErrorCode, message: string, closeCode?: number): void {
		if (!this.chat.getSession(client)) return;
		this.send(client, { event: 'error', data: { code, message } });
		if (closeCode !== undefined) {
			const member = this.chat.detach(client);
			client.close(closeCode, code);
			if (member) this.announceLeave(member);
		}
	}

	private handleFailure(client: WebSocket, error: unknown): void {
		if (error instanceof UnauthorizedException)
			this.reject(client, 'UNAUTHENTICATED', 'Please authenticate with a valid access token', 1008);
		else if (error instanceof ForbiddenException)
			this.reject(client, 'FORBIDDEN', 'This account is not available', 1008);
		else if (error instanceof BadRequestException) this.reject(client, 'BAD_REQUEST', error.message);
		else this.reject(client, 'INTERNAL_SERVER_ERROR', 'Chat temporarily unavailable', 1011);
	}

	private announceLeave(member: ChatMember): void {
		this.enqueue(async () => {
			const recipients = await this.validRecipients();
			this.broadcast(recipients, {
				event: 'info',
				data: { action: 'left', memberData: member, totalClients: this.chat.totalClients() },
			});
		});
	}

	private enqueue(work: () => Promise<void>): void {
		// Room serialization also keeps message broadcasts and retained history in the same order.
		this.roomQueue = this.roomQueue
			.then(async () => {
				if (!this.stopping) await work();
			})
			.catch(() => undefined);
	}
}
