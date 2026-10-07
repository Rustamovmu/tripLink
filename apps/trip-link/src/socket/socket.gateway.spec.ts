import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { AuthService, type AuthTokenPayload } from '../components/auth/auth.service';
import { MemberType } from '../libs/enums/member.enum';
import { SocketGateway } from './socket.gateway';
import { SocketService } from './socket.service';

class FakeClient extends EventEmitter {
	readyState: number = WebSocket.OPEN;
	frames: Array<{ event: string; data: Record<string, unknown> }> = [];
	send = jest.fn((frame: string, callback?: (error?: Error) => void) => {
		this.frames.push(JSON.parse(frame) as { event: string; data: Record<string, unknown> });
		callback?.();
	});
	close = jest.fn(() => {
		this.readyState = WebSocket.CLOSED;
	});
	terminate = jest.fn(() => {
		this.readyState = WebSocket.CLOSED;
	});
}

const payload: AuthTokenPayload = {
	sub: 'member-id',
	memberNick: 'Traveler',
	memberType: MemberType.USER,
	iat: 100,
	exp: 200,
};
const settle = async () => {
	await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('SocketGateway authentication and command boundaries', () => {
	let verify: jest.Mock<Promise<AuthTokenPayload>, [string]>;
	let chat: SocketService;
	let gateway: SocketGateway;
	let clients: FakeClient[];
	beforeEach(() => {
		verify = jest.fn<Promise<AuthTokenPayload>, [string]>().mockResolvedValue(payload);
		chat = new SocketService();
		gateway = new SocketGateway({ verifyToken: verify } as unknown as AuthService, chat);
		clients = [];
	});
	afterEach(() => {
		gateway.onModuleDestroy();
		jest.useRealTimers();
	});
	function connect() {
		const client = new FakeClient();
		clients.push(client);
		gateway.handleConnection(client as unknown as WebSocket);
		return client;
	}
	function send(client: FakeClient, event: string, data: unknown) {
		client.emit('message', Buffer.from(JSON.stringify({ event, data })), false);
	}
	async function authenticate(client: FakeClient) {
		send(client, 'authenticate', { token: 'private-token' });
		await settle();
	}

	it('rejects unauthenticated commands without sharing room state', async () => {
		const client = connect();
		send(client, 'getMessages', {});
		await settle();
		expect(client.frames).toEqual([
			{ event: 'error', data: { code: 'UNAUTHENTICATED', message: 'Please authenticate with a valid access token' } },
		]);
		expect(client.close).toHaveBeenCalledWith(1008, 'UNAUTHENTICATED');
		expect(verify).not.toHaveBeenCalled();
	});

	it('serializes authentication followed immediately by messages and exposes only public sender identity', async () => {
		const client = connect();
		send(client, 'authenticate', { token: 'private-token' });
		send(client, 'message', '  hello  ');
		await settle();
		expect(chat.history()).toHaveLength(1);
		expect(chat.history()[0]).toMatchObject({
			text: 'hello',
			memberData: { _id: payload.sub, memberNick: payload.memberNick, memberType: payload.memberType },
		});
		const frames = JSON.stringify(client.frames);
		for (const forbidden of ['private-token', '"iat"', '"exp"', 'memberPassword', 'memberEmail'])
			expect(frames).not.toContain(forbidden);
		expect(client.frames.map((frame) => frame.event)).toEqual(['authenticated', 'getMessages', 'info', 'message']);
	});

	it('reports malformed JSON, binary, unknown events and invalid text without changing history', async () => {
		const client = connect();
		await authenticate(client);
		client.emit('message', Buffer.from('{'), false);
		client.emit('message', Buffer.from('{}'), true);
		for (const [event, data] of [
			['unknown', {}],
			['message', '   '],
			['message', 'x'.repeat(1001)],
			['message', { text: 'spoof', memberId: 'other' }],
			['authenticate', { token: 'other' }],
		] as const)
			send(client, event, data);
		await settle();
		expect(client.frames.filter((frame) => frame.event === 'error')).toHaveLength(7);
		expect(chat.history()).toEqual([]);
		expect(client.close).not.toHaveBeenCalled();
	});

	it.each([new UnauthorizedException(), new ForbiddenException(), new Error('private database details')])(
		'closes failures with stable public codes',
		async (error) => {
			verify.mockRejectedValue(error);
			const client = connect();
			await authenticate(client);
			const code =
				error instanceof UnauthorizedException
					? 'UNAUTHENTICATED'
					: error instanceof ForbiddenException
						? 'FORBIDDEN'
						: 'INTERNAL_SERVER_ERROR';
			expect(client.frames[0].data.code).toBe(code);
			expect(client.close).toHaveBeenCalledWith(code === 'INTERNAL_SERVER_ERROR' ? 1011 : 1008, code);
			expect(JSON.stringify(client.frames)).not.toContain('private database details');
			expect(chat.totalClients()).toBe(0);
		},
	);

	it('does not admit a connection when verification finishes after its authentication deadline', async () => {
		jest.useFakeTimers();
		let resolve!: (member: AuthTokenPayload) => void;
		verify.mockImplementationOnce(
			() =>
				new Promise<AuthTokenPayload>((done) => {
					resolve = done;
				}),
		);
		const client = connect();
		send(client, 'authenticate', { token: 'private-token' });
		await jest.advanceTimersByTimeAsync(10000);
		resolve(payload);
		await jest.advanceTimersByTimeAsync(0);
		expect(client.frames.map((frame) => frame.event)).toEqual(['error']);
		expect(chat.totalClients()).toBe(0);
	});

	it('revalidates an authenticated client even when it repeats the authentication command', async () => {
		const client = connect();
		await authenticate(client);
		verify.mockRejectedValueOnce(new ForbiddenException());
		send(client, 'authenticate', { token: 'private-token' });
		await settle();
		expect(client.frames.at(-1)?.data.code).toBe('FORBIDDEN');
		expect(client.close).toHaveBeenCalledWith(1008, 'FORBIDDEN');
	});

	it('enforces frame and queue bounds without recording messages', async () => {
		const large = connect();
		large.emit('message', Buffer.from('x'.repeat(8193)), false);
		await settle();
		expect(large.close).toHaveBeenCalledWith(1009, 'BAD_REQUEST');
		const flooding = connect();
		for (let count = 0; count < 21; count++) send(flooding, 'getMessages', {});
		await settle();
		expect(flooding.close).toHaveBeenCalledWith(1013, 'TOO_MANY_REQUESTS');
		expect(chat.history()).toEqual([]);
	});

	it('removes a revoked recipient before delivering a broadcast', async () => {
		const recipient = connect();
		await authenticate(recipient);
		const sender = connect();
		send(sender, 'authenticate', { token: 'sender-token' });
		await settle();
		verify.mockImplementation((token) =>
			token === 'private-token' ? Promise.reject(new ForbiddenException()) : Promise.resolve(payload),
		);
		send(sender, 'message', 'safe broadcast');
		await settle();
		expect(recipient.frames.some((frame) => frame.event === 'message')).toBe(false);
		expect(recipient.close).toHaveBeenCalledWith(1008, 'FORBIDDEN');
		expect(sender.frames.some((frame) => frame.event === 'message')).toBe(true);
	});
});
