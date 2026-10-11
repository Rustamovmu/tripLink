import WebSocket from 'ws';
import { MemberType } from '../libs/enums/member.enum';
import { SocketService } from './socket.service';

const member = { _id: 'member-1', memberNick: 'Traveler', memberType: MemberType.USER };
const client = () => ({ readyState: WebSocket.OPEN, terminate: jest.fn() }) as unknown as WebSocket;

describe('SocketService room state', () => {
	it('retains the latest 50 messages in order and returns independent snapshots', () => {
		const service = new SocketService();
		for (let index = 0; index < 55; index++) service.addMessage(`message-${index}`, member);
		expect(service.history().map((message) => message.text)).toEqual(
			Array.from({ length: 50 }, (_, index) => `message-${index + 5}`),
		);
		const history = service.history();
		history[0].text = 'changed';
		history[0].memberData.memberNick = 'changed';
		expect(service.history()[0]).toMatchObject({ text: 'message-5', memberData: member });
		expect(new Set(service.history().map((message) => message._id)).size).toBe(50);
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

	it('deduplicates presence and aggregates typing across tabs with throttle and expiry', () => {
		const service = new SocketService();
		const first = client();
		const second = client();
		service.register(first).member = member;
		service.register(second).member = member;
		expect(service.presence()).toEqual({ list: [member], totalMembers: 1, totalClients: 2 });
		expect(service.setTyping(first, true, 10000)).toBe(true);
		expect(service.setTyping(first, true, 11000)).toBe(false);
		expect(service.setTyping(second, true, 12000)).toBe(true);
		expect(service.isTyping(member._id, 13000)).toBe(true);
		service.setTyping(first, false, 13000);
		expect(service.isTyping(member._id, 13000)).toBe(true);
		service.detach(first);
		expect(service.presence().totalMembers).toBe(1);
		expect(service.isTyping(member._id, 17000)).toBe(false);
		service.detach(second);
		expect(service.presence()).toEqual({ list: [], totalMembers: 0, totalClients: 0 });
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
