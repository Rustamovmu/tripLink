import WebSocket from 'ws';
import { MemberType } from '../libs/enums/member.enum';
import { SocketService } from './socket.service';

const member = { _id: 'member-1', memberNick: 'Traveler', memberType: MemberType.USER };
const client = () => ({ readyState: WebSocket.OPEN, terminate: jest.fn() }) as unknown as WebSocket;

describe('SocketService room state', () => {
	it('retains the latest five messages in order and returns independent snapshots', () => {
		const service = new SocketService();
		for (let index = 0; index < 7; index++) service.addMessage(`message-${index}`, member);
		expect(service.history().map((message) => message.text)).toEqual([
			'message-2',
			'message-3',
			'message-4',
			'message-5',
			'message-6',
		]);
		const history = service.history();
		history[0].text = 'changed';
		history[0].memberData.memberNick = 'changed';
		expect(service.history()[0]).toMatchObject({ text: 'message-2', memberData: member });
		expect(new Set(service.history().map((message) => message._id)).size).toBe(5);
	});

	it('counts only authenticated open sockets, including separate tabs', () => {
		const service = new SocketService();
		const first = client();
		const second = client();
		const anonymous = client();
		service.register(anonymous);
		service.register(first).member = member;
		service.register(second).member = member;
		expect(service.totalClients()).toBe(2);
		expect(service.detach(first)).toEqual(member);
		expect(service.detach(first)).toBeUndefined();
		expect(service.totalClients()).toBe(1);
		Object.defineProperty(second, 'readyState', { value: WebSocket.CLOSED });
		expect(service.totalClients()).toBe(0);
	});

	it('clears authentication timers, clients and memory during shutdown', () => {
		jest.useFakeTimers();
		try {
			const service = new SocketService();
			const terminate = jest.fn();
			const socket = { readyState: WebSocket.OPEN, terminate } as unknown as WebSocket;
			const timerCallback = jest.fn();
			service.register(socket).authTimer = setTimeout(timerCallback, 10000) as unknown as ReturnType<
				typeof import('node:timers').setTimeout
			>;
			service.addMessage('hello', member);
			service.shutdown();
			jest.advanceTimersByTime(10000);
			expect(timerCallback).not.toHaveBeenCalled();
			expect(terminate).toHaveBeenCalledTimes(1);
			expect(service.getSession(socket)).toBeUndefined();
			expect(service.history()).toEqual([]);
		} finally {
			jest.useRealTimers();
		}
	});
});
