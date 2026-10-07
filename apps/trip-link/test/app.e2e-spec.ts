import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from './../src/app.module';

jest.setTimeout(60000);

describe('AppController (isolated e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	const originalMongo = process.env.MONGO_DEV;
	const database = `tl_app_e2e_${new Types.ObjectId().toHexString()}`;
	const assertDatabase = () => {
		if (connection.name !== database || !/^tl_app_e2e_[a-f0-9]{24}$/.test(database))
			throw new Error('Unexpected smoke-test database');
	};

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Smoke tests cannot run in production');
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		const uri = new URL(originalMongo);
		uri.pathname = `/${database}`;
		process.env.MONGO_DEV = uri.toString();
		const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = moduleFixture.createNestApplication();
		connection = app.get<Connection>(getConnectionToken());
		assertDatabase();
		await app.init();
	});

	it('serves the TripLink welcome response', async () => {
		await request(app.getHttpServer()).get('/').expect(200).expect('Welcome to the Trip Link API!');
	});

	afterAll(async () => {
		try {
			if (connection) {
				assertDatabase();
				await connection.dropDatabase();
			}
		} finally {
			try {
				if (app) await app.close();
			} finally {
				if (originalMongo === undefined) delete process.env.MONGO_DEV;
				else process.env.MONGO_DEV = originalMongo;
			}
		}
	});
});
