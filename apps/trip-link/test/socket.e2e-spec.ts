import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { MemberType } from '../src/libs/enums/member.enum';
import { SocketService } from '../src/socket/socket.service';
import type { ChatResponse } from '../src/socket/socket.types';

jest.setTimeout(30000);
type Actor = { id: Types.ObjectId; token: string; role: MemberType; nick: string };

class LiveClient {
	readonly socket: WebSocket;
	readonly opened: Promise<void>;
	readonly closed: Promise<number>;
	readonly frames: ChatResponse[] = [];
	private readonly listeners = new Set<() => void>();
	constructor(url: string) {
		this.socket = new WebSocket(url);
		this.opened = new Promise<void>((resolve, reject) => {
			this.socket.once('open', resolve);
			this.socket.once('error', reject);
		});
		this.closed = new Promise<number>((resolve) => this.socket.once('close', resolve));
		this.socket.on('message', (raw) => {
			const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
			this.frames.push(JSON.parse(bytes.toString('utf8')) as ChatResponse);
			for (const listener of this.listeners) listener();
		});
	}
	send(event: string, data: unknown) {
		this.socket.send(JSON.stringify({ event, data }));
	}
	next<E extends ChatResponse['event']>(
		event: E,
		predicate: (frame: Extract<ChatResponse, { event: E }>) => boolean = () => true,
	): Promise<Extract<ChatResponse, { event: E }>> {
		return new Promise((resolve, reject) => {
			const check = () => {
				const index = this.frames.findIndex(
					(frame) => frame.event === event && predicate(frame as Extract<ChatResponse, { event: E }>),
				);
				if (index < 0) return;
				clearTimeout(timer);
				this.listeners.delete(check);
				resolve(this.frames.splice(index, 1)[0] as Extract<ChatResponse, { event: E }>);
			};
			const timer = setTimeout(() => {
				this.listeners.delete(check);
				reject(new Error(`Timed out waiting for ${event}`));
			}, 5000);
			this.listeners.add(check);
			check();
		});
	}
}

describe('Authenticated shared group chat (real WebSocket e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let originalMongo: string | undefined;
	let database: string;
	let endpoint: string;
	let clients: LiveClient[];
	let user: Actor;
	let agent: Actor;
	let admin: Actor;

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Socket tests cannot run in production');
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = `tl_ws_e2e_${new Types.ObjectId().toHexString()}`;
		const url = new URL(originalMongo);
		url.pathname = `/${database}`;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication();
		app.useWebSocketAdapter(new WsAdapter(app));
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.listen(0, '127.0.0.1');
		const server = app.getHttpServer() as import('node:http').Server;
		const address = server.address() as AddressInfo;
		endpoint = `ws://127.0.0.1:${address.port}/chat`;
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== database) throw new Error('Unexpected socket database');
		user = await actor(MemberType.USER);
		agent = await actor(MemberType.AGENT);
		admin = await actor(MemberType.ADMIN);
	});
	beforeEach(() => {
		clients = [];
	});
	afterEach(async () => {
		for (const client of clients) client.socket.terminate();
		await Promise.all(clients.map((client) => client.closed));
	});
	afterAll(async () => {
		try {
			if (connection && connection.name === database && /^tl_ws_e2e_[a-f0-9]{24}$/.test(database))
				await connection.dropDatabase();
		} finally {
			if (app) await app.close();
			if (originalMongo === undefined) delete process.env.MONGO_DEV;
			else process.env.MONGO_DEV = originalMongo;
		}
	});

	it('authenticates all three roles, sends history and broadcasts to the sender and other members', async () => {
		const a = await connect(user.token);
		const b = await connect(agent.token);
		const c = await connect(admin.token);
		a.send('message', '  Hello shared room  ');
		for (const client of [a, b, c]) {
			const response = await client.next('message', (frame) => frame.data.text === 'Hello shared room');
			expect(response.data.memberData).toEqual({
				_id: user.id.toHexString(),
				memberNick: user.nick,
				memberType: user.role,
			});
			expect(Object.keys(response.data.memberData).sort()).toEqual(['_id', 'memberNick', 'memberType']);
		}
	});

	it('retains the last five messages in stable broadcast order and returns them on reconnect', async () => {
		const a = await connect(user.token);
		const b = await connect(agent.token);
		for (let index = 0; index < 7; index++) (index % 2 === 0 ? a : b).send('message', `history-${index}`);
		const received: string[] = [];
		for (let index = 0; index < 7; index++)
			received.push((await a.next('message', (frame) => frame.data.text.startsWith('history-'))).data.text);
		const c = await open();
		c.send('authenticate', { token: admin.token });
		await c.next('authenticated');
		const history = (await c.next('getMessages')).data.list;
		expect(history.map((message) => message.text)).toEqual(received.slice(-5));
		expect(history).toHaveLength(5);
		c.send('getMessages', {});
		expect((await c.next('getMessages')).data.list).toEqual(history);
	});

	it('counts authenticated sockets including two tabs and announces disconnection exactly once', async () => {
		const a = await connect(user.token);
		const anonymous = await open();
		const b = await open();
		b.send('authenticate', { token: user.token });
		expect((await b.next('authenticated')).data.totalClients).toBe(2);
		const joined = await a.next('info', (frame) => frame.data.action === 'joined' && frame.data.totalClients === 2);
		expect(joined.data.memberData._id).toBe(user.id.toHexString());
		b.socket.close();
		await b.closed;
		expect((await a.next('info', (frame) => frame.data.action === 'left')).data.totalClients).toBe(1);
		a.send('getMessages', {});
		await a.next('getMessages');
		expect(anonymous.frames).toEqual([]);
	});

	it('rejects missing, malformed and expired tokens and never sends room data to those clients', async () => {
		const expired = await app
			.get<JwtService>(JwtService)
			.signAsync({ sub: user.id.toHexString(), memberType: user.role }, { expiresIn: -1 });
		for (const token of [undefined, 'invalid', expired]) {
			const client = await open();
			client.send(token === undefined ? 'getMessages' : 'authenticate', token === undefined ? {} : { token });
			expect((await client.next('error')).data.code).toBe('UNAUTHENTICATED');
			expect(await client.closed).toBe(1008);
			expect(
				client.frames.some((frame) => ['message', 'getMessages', 'info', 'authenticated'].includes(frame.event)),
			).toBe(false);
		}
	});

	it('closes an idle client after the real authentication deadline', async () => {
		const client = await open();
		expect(await client.closed).toBe(1008);
		expect((await client.next('error')).data.code).toBe('UNAUTHENTICATED');
		expect(client.frames).toEqual([]);
	});

	it('rejects a previously authenticated token once it expires', async () => {
		const token = await app
			.get<JwtService>(JwtService)
			.signAsync({ sub: user.id.toHexString(), memberType: user.role, memberNick: user.nick }, { expiresIn: 2 });
		const client = await connect(token);
		await new Promise<void>((resolve) => setTimeout(resolve, 2200));
		client.send('getMessages', {});
		expect((await client.next('error')).data.code).toBe('UNAUTHENTICATED');
		expect(await client.closed).toBe(1008);
	});

	it('does not leak broadcasts or history to an idle unauthenticated connection', async () => {
		const anonymous = await open();
		const member = await connect(user.token);
		member.send('message', 'private room content');
		await member.next('message', (frame) => frame.data.text === 'private room content');
		expect(anonymous.frames).toEqual([]);
	});

	it('handles authentication and message frames arriving together without losing or spoofing identity', async () => {
		const client = await open();
		client.send('authenticate', { token: user.token });
		client.send('message', 'queued after auth');
		await client.next('authenticated');
		expect((await client.next('message', (frame) => frame.data.text === 'queued after auth')).data.memberData._id).toBe(
			user.id.toHexString(),
		);
	});

	it('rejects malformed frames, empty or long messages, forged sender objects and oversized frames', async () => {
		const client = await connect(user.token);
		client.send('getMessages', {});
		const before = (await client.next('getMessages')).data.list;
		client.socket.send('{');
		expect((await client.next('error')).data.code).toBe('BAD_REQUEST');
		client.socket.send(Buffer.from('binary'));
		expect((await client.next('error')).data.code).toBe('BAD_REQUEST');
		for (const [event, data] of [
			['unknown', {}],
			['message', ' '],
			['message', 'x'.repeat(1001)],
			['message', { text: 'forged', memberId: admin.id.toHexString() }],
		] as const) {
			client.send(event, data);
			expect((await client.next('error')).data.code).toBe('BAD_REQUEST');
		}
		client.send('getMessages', {});
		expect((await client.next('getMessages')).data.list).toEqual(before);
		client.socket.send('x'.repeat(8193));
		expect(await client.closed).toBe(1009);
	});

	it.each(['BLOCK', 'SUSPENDED', 'PENDING', 'DELETE', 'role-change', 'physically-deleted'])(
		'revokes a connected sender after %s without appending a message',
		async (change) => {
			const actorRecord = await actor(MemberType.USER);
			const client = await connect(actorRecord.token);
			client.send('getMessages', {});
			const before = (await client.next('getMessages')).data.list;
			if (change === 'physically-deleted') await connection.collection('members').deleteOne({ _id: actorRecord.id });
			else
				await connection
					.collection('members')
					.updateOne(
						{ _id: actorRecord.id },
						{ $set: change === 'role-change' ? { memberType: 'AGENT' } : { memberStatus: change } },
					);
			client.send('message', `rejected-${change}`);
			const code = (await client.next('error')).data.code;
			expect(code).toBe(
				['DELETE', 'role-change', 'physically-deleted'].includes(change) ? 'UNAUTHENTICATED' : 'FORBIDDEN',
			);
			expect(await client.closed).toBe(1008);
			const reader = await connect(user.token);
			reader.send('getMessages', {});
			expect((await reader.next('getMessages')).data.list).toEqual(before);
		},
	);

	it('checks idle recipients before broadcasts and refreshes the sending nickname from MongoDB', async () => {
		const recipient = await actor(MemberType.USER);
		const a = await connect(recipient.token);
		const b = await connect(agent.token);
		await connection.collection('members').updateOne({ _id: recipient.id }, { $set: { memberStatus: 'BLOCK' } });
		const refreshedNick = `updated-${new Types.ObjectId().toHexString()}`;
		await connection.collection('members').updateOne({ _id: agent.id }, { $set: { memberNick: refreshedNick } });
		b.send('message', 'recipient access check');
		expect((await a.next('error')).data.code).toBe('FORBIDDEN');
		expect(await a.closed).toBe(1008);
		expect(a.frames.some((frame) => frame.event === 'message' && frame.data.text === 'recipient access check')).toBe(
			false,
		);
		expect(
			(await b.next('message', (frame) => frame.data.text === 'recipient access check')).data.memberData.memberNick,
		).toBe(refreshedNick);
		await connection.collection('members').updateOne({ _id: agent.id }, { $set: { memberNick: agent.nick } });
	});

	it('reports database errors as server errors without exposing internal details (injected failure)', async () => {
		const client = await connect(user.token);
		client.send('getMessages', {});
		const before = (await client.next('getMessages')).data.list;
		const spy = jest
			.spyOn(app.get<AuthService>(AuthService), 'verifyToken')
			.mockRejectedValueOnce(new Error('private database failure details'));
		try {
			client.send('message', 'must not be recorded');
			const error = await client.next('error');
			expect(error.data).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: 'Chat temporarily unavailable' });
			expect(await client.closed).toBe(1011);
		} finally {
			spy.mockRestore();
		}
		expect(app.get<SocketService>(SocketService).history()).toEqual(before);
	});

	async function actor(role: MemberType): Promise<Actor> {
		const id = new Types.ObjectId();
		const nick = `ws-${id.toHexString()}`;
		await app.get<Model<unknown>>(getModelToken('Member')).create({
			_id: id,
			memberNick: nick,
			memberPassword: 'disposable-test-hash',
			memberType: role,
			memberStatus: 'ACTIVE',
		});
		return {
			id,
			nick,
			role,
			token: await app.get<AuthService>(AuthService).createToken({ _id: id, memberNick: nick, memberType: role }),
		};
	}
	async function open(): Promise<LiveClient> {
		const client = new LiveClient(endpoint);
		clients.push(client);
		await client.opened;
		return client;
	}
	async function connect(token: string): Promise<LiveClient> {
		const client = await open();
		client.send('authenticate', { token });
		await client.next('authenticated');
		await client.next('getMessages');
		return client;
	}
});
