import { ConfigService } from '@nestjs/config';
import { RankingService } from './ranking.service';

describe('Ranking worker controls', () => {
	let service: RankingService;
	const execute = jest.fn();
	const close = jest.fn();
	const tours = { updateMany: jest.fn(() => ({ exec: execute })) };
	const members = {
		updateMany: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({}) })),
		aggregate: jest.fn(() => ({
			cursor: () => ({
				async *[Symbol.asyncIterator]() {
					/* Empty agent stream. */
				},
				close,
			}),
		})),
	};
	const config = { get: jest.fn() };
	beforeEach(() => {
		jest.clearAllMocks();
		execute.mockResolvedValue({});
		config.get.mockReturnValue('true');
		service = new RankingService(
			tours as unknown as ConstructorParameters<typeof RankingService>[0],
			members as unknown as ConstructorParameters<typeof RankingService>[1],
			config as unknown as ConfigService,
		);
	});
	it('does no writes unless the flag is exactly true', async () => {
		for (const value of [undefined, 'false', 'TRUE', true]) {
			config.get.mockReturnValue(value);
			expect(await service.runRanking()).toEqual({ state: 'disabled' });
		}
		expect(tours.updateMany).not.toHaveBeenCalled();
		expect(members.updateMany).not.toHaveBeenCalled();
	});
	it('prevents overlapping passes and waits for shutdown', async () => {
		let release: () => void = () => undefined;
		execute.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		const running = service.runRanking();
		expect(await service.runRanking()).toEqual({ state: 'busy' });
		let stopped = false;
		const shutdown = service.onModuleDestroy().then(() => {
			stopped = true;
		});
		await Promise.resolve();
		expect(stopped).toBe(false);
		release();
		await running;
		await shutdown;
		expect(await service.runRanking()).toEqual({ state: 'stopping' });
		expect(close).toHaveBeenCalled();
	});
	it('releases the busy state after a failure so the next pass retries', async () => {
		execute.mockRejectedValueOnce(new Error('Injected failure'));
		await expect(service.runRanking()).rejects.toThrow('Injected failure');
		expect(await service.runRanking()).toEqual({ state: 'completed' });
		expect(close).toHaveBeenCalled();
	});
});
