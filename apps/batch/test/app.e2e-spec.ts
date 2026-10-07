import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { BatchModule } from './../src/batch.module';
import { BatchService, BOOKING_EXPIRY_JOB } from './../src/batch.service';

jest.setTimeout(60000);

describe('BatchController (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	const originalMongo = process.env.MONGO_DEV;
	const originalEnabled = process.env.BATCH_BOOKING_EXPIRY_ENABLED;
	const database = `tl_bs_e2e_${new Types.ObjectId().toHexString()}`;

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production' || !originalMongo) throw new Error('A development Mongo URI is required');
		const uri = new URL(originalMongo);
		uri.pathname = `/${database}`;
		process.env.MONGO_DEV = uri.toString();
		process.env.BATCH_BOOKING_EXPIRY_ENABLED = 'false';
		const moduleFixture = await Test.createTestingModule({ imports: [BatchModule] }).compile();
		app = moduleFixture.createNestApplication();
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== database) throw new Error('Unexpected test database');
		await app.init();
	});

	afterAll(async () => {
		try {
			if (connection) {
				if (connection.name !== database || !/^tl_bs_e2e_[a-f0-9]{24}$/.test(database))
					throw new Error('Unsafe cleanup');
				await connection.dropDatabase();
			}
		} finally {
			try {
				if (app) await app.close();
			} finally {
				if (originalMongo === undefined) delete process.env.MONGO_DEV;
				else process.env.MONGO_DEV = originalMongo;
				if (originalEnabled === undefined) delete process.env.BATCH_BOOKING_EXPIRY_ENABLED;
				else process.env.BATCH_BOOKING_EXPIRY_ENABLED = originalEnabled;
			}
		}
	});

	it('serves the batch welcome route without a GraphQL endpoint', async () => {
		await request(app.getHttpServer()).get('/').expect(200).expect('Welcome to the Batch API!');
		await request(app.getHttpServer()).post('/graphql').expect(404);
	});
	it('registers the job but performs no expiry without opt-in', async () => {
		expect(app.get(SchedulerRegistry).getCronJob(BOOKING_EXPIRY_JOB)).toBeDefined();
		expect((await app.get(BatchService).runBookingExpiry()).state).toBe('disabled');
	});
});
