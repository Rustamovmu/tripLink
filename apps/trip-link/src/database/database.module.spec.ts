import { Connection, STATES } from 'mongoose';
import { DatabaseModule, getDatabaseOptions } from './database.module';

describe('Database connection configuration', () => {
	const productionUri = 'mongodb://example.invalid/TripLinkProd';
	const disposableUri = 'mongodb://example.invalid/tl_app_e2e_0123456789abcdef01234567';

	it.each(['development', 'production', undefined])('uses only MONGO_PROD with NODE_ENV=%s', (mode) => {
		expect(getDatabaseOptions({ NODE_ENV: mode, MONGO_PROD: productionUri, MONGO_DEV: disposableUri })).toEqual({
			uri: productionUri,
		});
	});

	it.each([undefined, '', '   '])('rejects missing MONGO_PROD instead of falling back to MONGO_DEV (%s)', (uri) => {
		expect(() => getDatabaseOptions({ NODE_ENV: 'development', MONGO_PROD: uri, MONGO_DEV: disposableUri })).toThrow(
			'MONGO_PROD is required',
		);
	});

	it('allows startup without MONGO_DEV', () => {
		expect(getDatabaseOptions({ MONGO_PROD: productionUri })).toEqual({ uri: productionUri });
	});

	it('keeps the integration-test connection isolated from MONGO_PROD', () => {
		expect(
			getDatabaseOptions({
				NODE_ENV: 'test',
				JEST_WORKER_ID: '1',
				MONGO_DEV: disposableUri,
				MONGO_PROD: productionUri,
			}),
		).toEqual({ uri: disposableUri });
	});

	it('rejects missing test configuration instead of falling back to MONGO_PROD', () => {
		expect(() => getDatabaseOptions({ NODE_ENV: 'test', MONGO_PROD: productionUri })).toThrow('MONGO_DEV is required');
	});

	it.each(['development', 'production', undefined])('blocks Jest from using the application database in %s', (mode) => {
		expect(() => getDatabaseOptions({ NODE_ENV: mode, JEST_WORKER_ID: '1', MONGO_PROD: productionUri })).toThrow(
			'Database tests require NODE_ENV=test',
		);
	});

	it('logs the actual connected database name without credentials', () => {
		const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
		try {
			new DatabaseModule({ readyState: STATES.connected, name: 'TripLinkProd' } as Connection);
			expect(log).toHaveBeenCalledWith('Database connected: TripLinkProd');
		} finally {
			log.mockRestore();
		}
	});
});
