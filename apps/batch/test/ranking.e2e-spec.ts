import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { BatchModule } from '../src/batch.module';
import { BOOKING_EXPIRY_JOB } from '../src/batch.service';
import { RankingService, RANKING_JOB } from '../src/ranking.service';

jest.setTimeout(120000);

describe('Ranking recalculation (disposable MongoDB)', () => {
	let app: INestApplication;
	let connection: Connection;
	let worker: RankingService;
	const database = `tl_rank_batch_${new Types.ObjectId().toHexString()}`;
	const originalMongo = process.env.MONGO_DEV;
	const originalRanking = process.env.BATCH_RANKING_ENABLED;
	const originalExpiry = process.env.BATCH_BOOKING_EXPIRY_ENABLED;
	const agentId = new Types.ObjectId();
	const updatedAt = new Date('2026-01-01');
	const assertDatabase = () => {
		if (connection.name !== database || !/^tl_rank_batch_[a-f0-9]{24}$/.test(database))
			throw new Error('Unsafe ranking fixture database');
	};
	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production' || !originalMongo) throw new Error('Development Mongo URI required');
		const uri = new URL(originalMongo);
		uri.pathname = `/${database}`;
		process.env.MONGO_DEV = uri.toString();
		process.env.BATCH_RANKING_ENABLED = 'false';
		process.env.BATCH_BOOKING_EXPIRY_ENABLED = 'false';
		const module = await Test.createTestingModule({ imports: [BatchModule] }).compile();
		app = module.createNestApplication({ logger: false });
		connection = app.get<Connection>(getConnectionToken());
		assertDatabase();
		await app.init();
		for (const name of [RANKING_JOB, BOOKING_EXPIRY_JOB])
			app.get<SchedulerRegistry>(SchedulerRegistry).getCronJob(name).stop();
		for (const name of ['Member', 'Tour']) await app.get<Model<object>>(getModelToken(name)).init();
		worker = app.get(RankingService);
	});
	beforeEach(async () => {
		assertDatabase();
		await connection.collection('members').deleteMany({});
		await connection.collection('tours').deleteMany({});
		process.env.BATCH_RANKING_ENABLED = 'true';
		await connection.collection('members').insertMany([
			{
				_id: agentId,
				memberNick: 'disposable-rank-agent',
				memberType: 'AGENT',
				memberStatus: 'ACTIVE',
				memberTours: 999,
				memberFollowers: 2,
				memberLikes: 3,
				memberViews: 4,
				updatedAt,
			},
			...['USER', 'ADMIN', 'BLOCK', 'SUSPENDED', 'DELETE', 'PENDING'].map((state) => ({
				memberNick: `disposable-rank-${state}`,
				memberType: ['USER', 'ADMIN'].includes(state) ? state : 'AGENT',
				memberStatus: ['USER', 'ADMIN'].includes(state) ? 'ACTIVE' : state,
				agentRank: 999,
				updatedAt,
			})),
		]);
		await connection.collection('tours').insertMany(
			['ACTIVE', 'SOLD_OUT', 'DRAFT', 'PENDING', 'COMPLETED', 'CANCELLED'].map((tourStatus) => ({
				agentId,
				tourStatus,
				tourSlug: `disposable-rank-${tourStatus}`,
				tourFavoriteCount: 3,
				tourViewCount: 7,
				tourRank: 999,
				updatedAt,
			})),
		);
	});
	afterEach(() => jest.restoreAllMocks());
	afterAll(async () => {
		try {
			if (connection) {
				assertDatabase();
				await connection.dropDatabase();
			}
		} finally {
			try {
				await app?.close();
			} finally {
				for (const [key, value] of Object.entries({
					MONGO_DEV: originalMongo,
					BATCH_RANKING_ENABLED: originalRanking,
					BATCH_BOOKING_EXPIRY_ENABLED: originalExpiry,
				})) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			}
		}
	});
	const snapshot = async () => ({
		tours: await connection.collection('tours').find().sort({ _id: 1 }).toArray(),
		members: await connection.collection('members').find().sort({ _id: 1 }).toArray(),
	});
	it('persists exact formulas, resets ineligible scores, and preserves all other fields', async () => {
		const before = await snapshot();
		expect(await worker.runRanking()).toEqual({ state: 'completed' });
		const after = await snapshot();
		for (let index = 0; index < after.tours.length; index++) {
			const { tourRank, ...rest } = after.tours[index];
			const { tourRank: oldRank, ...oldRest } = before.tours[index];
			expect(oldRank).toBe(999);
			expect(rest).toEqual(oldRest);
			expect(tourRank).toBe(['ACTIVE', 'SOLD_OUT'].includes(rest.tourStatus as string) ? 13 : 0);
		}
		for (let index = 0; index < after.members.length; index++) {
			const { agentRank, ...rest } = after.members[index];
			const oldRest = { ...before.members[index] };
			delete oldRest.agentRank;
			expect(rest).toEqual(oldRest);
			expect(agentRank).toBe(rest._id.equals(agentId) ? 26 : 0);
		}
		await worker.runRanking();
		expect(await snapshot()).toEqual(after);
	});
	it('handles missing legacy counters and recomputes after visibility changes', async () => {
		await connection.collection('tours').updateMany({}, { $unset: { tourFavoriteCount: '', tourViewCount: '' } });
		await connection.collection('members').updateOne(
			{ _id: agentId },
			{
				$unset: { memberFollowers: '', memberLikes: '', memberViews: '' },
			},
		);
		await worker.runRanking();
		expect(await connection.collection('tours').distinct('tourRank')).toEqual([0]);
		expect((await connection.collection('members').findOne({ _id: agentId }))?.agentRank).toBe(10);
		await connection.collection('tours').updateMany({}, { $set: { tourStatus: 'CANCELLED' } });
		await worker.runRanking();
		expect((await connection.collection('members').findOne({ _id: agentId }))?.agentRank).toBe(0);
	});
	it('registered cron runs only when opted in and uses Seoul daily scheduling', async () => {
		const before = await snapshot();
		process.env.BATCH_RANKING_ENABLED = 'false';
		await worker.scheduledRanking();
		expect(await snapshot()).toEqual(before);
		jest.spyOn(app.get<ConfigService>(ConfigService), 'get').mockReturnValue('true');
		const job = app.get<SchedulerRegistry>(SchedulerRegistry).getCronJob(RANKING_JOB);
		expect(job.cronTime.timeZone).toBe('Asia/Seoul');
		const next = job.nextDates(1)[0];
		expect([next.hour, next.minute, next.second]).toEqual([1, 0, 0]);
		const run = worker.runRanking.bind(worker) as () => ReturnType<RankingService['runRanking']>;
		let finish: () => void = () => undefined;
		const finished = new Promise<void>((resolve) => {
			finish = resolve;
		});
		jest.spyOn(worker, 'runRanking').mockImplementation(async () => {
			try {
				return await run();
			} finally {
				finish();
			}
		});
		void job.fireOnTick();
		await finished;
		expect((await connection.collection('members').findOne({ _id: agentId }))?.agentRank).toBe(26);
	});
});
