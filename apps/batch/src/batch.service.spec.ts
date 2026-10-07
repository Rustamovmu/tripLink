import { ConflictException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { BatchService } from './batch.service';

describe('BatchService scheduling and bounded progress (mock database)', () => {
	const execute = jest.fn();
	const query = { select: jest.fn(), sort: jest.fn(), limit: jest.fn(), lean: jest.fn(), exec: execute };
	const model = { find: jest.fn(() => query) };
	const expiry = { expireBooking: jest.fn() };
	const config = { get: jest.fn() };
	let service: BatchService;
	const candidate = () => ({ _id: new Types.ObjectId(), selectedDate: new Date('2020-01-01') });

	beforeEach(() => {
		jest.resetAllMocks();
		for (const method of ['select', 'sort', 'limit', 'lean'] as const) query[method].mockReturnValue(query);
		model.find.mockReturnValue(query);
		execute.mockResolvedValue([]);
		expiry.expireBooking.mockResolvedValue({});
		config.get.mockReturnValue('true');
		for (const method of ['log', 'warn', 'error'] as const)
			jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined);
		service = new BatchService(
			model as unknown as ConstructorParameters<typeof BatchService>[0],
			expiry as unknown as ConstructorParameters<typeof BatchService>[1],
			config as unknown as ConfigService,
		);
	});
	afterEach(() => jest.restoreAllMocks());

	it('requires the exact opt-in value', async () => {
		for (const value of [undefined, 'false', 'TRUE', true]) {
			config.get.mockReturnValue(value);
			expect((await service.runBookingExpiry()).state).toBe('disabled');
		}
		expect(model.find).not.toHaveBeenCalled();
	});

	it('uses a fixed cutoff, stable ordering and projected pages', async () => {
		execute.mockResolvedValueOnce([candidate(), candidate()]);
		expect(await service.runBookingExpiry()).toEqual({ state: 'completed', scanned: 2, expired: 2, skipped: 0 });
		expect(query.select).toHaveBeenCalledWith('_id selectedDate');
		expect(query.sort).toHaveBeenCalledWith({ selectedDate: 1, _id: 1 });
		expect(query.limit).toHaveBeenCalledWith(100);
		const calls = expiry.expireBooking.mock.calls as unknown[][];
		expect(calls[0][1]).toBe(calls[1][1]);
		expect(model.find).toHaveBeenCalledWith(
			expect.objectContaining({ paymentStatus: 'UNPAID', selectedDate: { $lte: calls[0][1] } }),
		);
	});

	it('caps a pass at 1000 and continues past poisoned records on the next pass', async () => {
		const rows = Array.from({ length: 1001 }, candidate).sort((a, b) =>
			a._id.toHexString().localeCompare(b._id.toHexString()),
		);
		for (let page = 0; page < 10; page++) execute.mockResolvedValueOnce(rows.slice(page * 100, page * 100 + 100));
		expiry.expireBooking.mockRejectedValue(new ConflictException());
		expect(await service.runBookingExpiry()).toMatchObject({ scanned: 1000, skipped: 1000, expired: 0 });
		expect(model.find).toHaveBeenCalledTimes(10);
		execute.mockResolvedValueOnce([rows[1000]]);
		expiry.expireBooking.mockResolvedValue({});
		expect(await service.runBookingExpiry()).toMatchObject({ scanned: 1, expired: 1 });
		expect(model.find).toHaveBeenNthCalledWith(
			11,
			expect.objectContaining({
				$or: [
					{ selectedDate: { $gt: rows[999].selectedDate } },
					{ selectedDate: rows[999].selectedDate, _id: { $gt: rows[999]._id } },
				],
			}),
		);
		await service.runBookingExpiry();
		const calls = model.find.mock.calls as unknown as Array<[Record<string, unknown>]>;
		expect(calls[11][0].$or).toBeUndefined();
	});

	it('skips an already-settled candidate without starving the next booking', async () => {
		execute.mockResolvedValueOnce([candidate(), candidate()]);
		expiry.expireBooking.mockRejectedValueOnce(new NotFoundException());
		expect(await service.runBookingExpiry()).toMatchObject({ scanned: 2, skipped: 1, expired: 1 });
	});

	it('retries after the last successful candidate on a server failure', async () => {
		const rows = [candidate(), candidate()];
		execute.mockResolvedValueOnce(rows);
		expiry.expireBooking.mockResolvedValueOnce({}).mockRejectedValueOnce(new InternalServerErrorException());
		await expect(service.runBookingExpiry()).rejects.toBeInstanceOf(InternalServerErrorException);
		execute.mockResolvedValueOnce([rows[1]]);
		expect(await service.runBookingExpiry()).toMatchObject({ expired: 1 });
		expect(model.find).toHaveBeenLastCalledWith(
			expect.objectContaining({
				$or: [
					{ selectedDate: { $gt: rows[0].selectedDate } },
					{ selectedDate: rows[0].selectedDate, _id: { $gt: rows[0]._id } },
				],
			}),
		);
	});

	it('contains scheduled query failures and allows another tick', async () => {
		execute.mockRejectedValueOnce(new Error('database unavailable'));
		await service.scheduledBookingExpiry();
		expect(jest.spyOn(Logger.prototype, 'error')).toHaveBeenCalledTimes(1);
		execute.mockResolvedValueOnce([candidate()]);
		await service.scheduledBookingExpiry();
		expect(expiry.expireBooking).toHaveBeenCalledTimes(1);
	});

	it('prevents overlap and waits for current work during shutdown', async () => {
		let release: () => void = () => undefined;
		let started: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		execute.mockResolvedValueOnce([candidate(), candidate()]);
		expiry.expireBooking.mockImplementationOnce(async () => {
			started();
			await gate;
			return {};
		});
		const pass = service.runBookingExpiry();
		await ready;
		expect((await service.runBookingExpiry()).state).toBe('busy');
		let closed = false;
		const closing = service.onModuleDestroy().then(() => {
			closed = true;
		});
		try {
			expect((await service.runBookingExpiry()).state).toBe('stopping');
			expect(closed).toBe(false);
		} finally {
			release();
			await closing;
		}
		expect(await pass).toMatchObject({ scanned: 1, expired: 1 });
		expect(expiry.expireBooking).toHaveBeenCalledTimes(1);
	});
});
