import { INestApplication, InternalServerErrorException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { BatchModule } from '../src/batch.module';
import { BatchService, BOOKING_EXPIRY_JOB } from '../src/batch.service';
import { AppModule } from '../../trip-link/src/app.module';
import { AuthService } from '../../trip-link/src/components/auth/auth.service';
import { BookingExpiryService } from '../../trip-link/src/components/booking/booking-expiry.service';
import { MemberType } from '../../trip-link/src/libs/enums/member.enum';

jest.setTimeout(120000);
type Candidate = { _id: Types.ObjectId; selectedDate: Date };
type GraphResponse = { data?: Record<string, { bookingStatus: string }> | null; errors?: unknown[] };
type TourEligibilityModel = {
	updateOne(
		filter: { _id: Types.ObjectId; tourStatus: { $in: string[] } },
		update: { $inc: { __v: number } },
		options: { session: ClientSession; timestamps: boolean },
	): ReturnType<Model<object>['updateOne']>;
};

describe('Scheduled unpaid expiry (real disposable MongoDB)', () => {
	let app: INestApplication;
	let api: INestApplication;
	let connection: Connection;
	let apiConnection: Connection;
	let model: Model<Candidate>;
	let expiry: BookingExpiryService;
	let worker: BatchService;
	let adminToken: string;
	const userId = new Types.ObjectId();
	const agentId = new Types.ObjectId();
	const adminId = new Types.ObjectId();
	const database = `tl_be_e2e_${new Types.ObjectId().toHexString()}`;
	const originalMongo = process.env.MONGO_DEV;
	const originalEnabled = process.env.BATCH_BOOKING_EXPIRY_ENABLED;
	const enabledConfig = new ConfigService();
	const quiet = { log: () => undefined, error: () => undefined, warn: () => undefined };
	const newWorker = () => new BatchService(model, expiry, enabledConfig);
	const assertDatabase = (conn: Connection) => {
		if (conn.name !== database || !/^tl_be_e2e_[a-f0-9]{24}$/.test(database))
			throw new Error('Unsafe fixture database');
	};

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production' || !originalMongo) throw new Error('A development Mongo URI is required');
		const uri = new URL(originalMongo);
		uri.pathname = `/${database}`;
		process.env.MONGO_DEV = uri.toString();
		process.env.BATCH_BOOKING_EXPIRY_ENABLED = 'false';
		const module = await Test.createTestingModule({ imports: [BatchModule] }).compile();
		app = module.createNestApplication({ logger: quiet });
		connection = app.get<Connection>(getConnectionToken());
		assertDatabase(connection);
		await app.init();
		app.get(SchedulerRegistry).getCronJob(BOOKING_EXPIRY_JOB).stop();
		model = app.get<Model<Candidate>>(getModelToken('Booking'));
		expiry = app.get(BookingExpiryService);
		await model.init();
		await app.get<Model<object>>(getModelToken('Tour')).init();
		const apiModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
		api = apiModule.createNestApplication({ logger: quiet });
		apiConnection = api.get<Connection>(getConnectionToken());
		assertDatabase(apiConnection);
		api.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await api.init();
		await connection.collection('members').insertMany([
			{
				_id: userId,
				memberNick: 'disposable-expiry-user',
				memberType: 'USER',
				memberStatus: 'ACTIVE',
				memberBookings: 17,
			},
			{
				_id: agentId,
				memberNick: 'disposable-expiry-agent',
				memberType: 'AGENT',
				memberStatus: 'ACTIVE',
				memberBookings: 23,
			},
			{ _id: adminId, memberNick: 'disposable-expiry-admin', memberType: 'ADMIN', memberStatus: 'ACTIVE' },
		]);
		adminToken = await api
			.get(AuthService)
			.createToken({ _id: adminId, memberType: MemberType.ADMIN, memberNick: 'disposable-expiry-admin' });
	});
	beforeEach(async () => {
		assertDatabase(connection);
		await connection.collection('bookings').deleteMany({});
		await connection.collection('tours').deleteMany({});
		jest.spyOn(enabledConfig, 'get').mockReturnValue('true');
		worker = newWorker();
	});
	afterEach(() => jest.restoreAllMocks());
	afterAll(async () => {
		try {
			if (connection) {
				assertDatabase(connection);
				await connection.dropDatabase();
			}
		} finally {
			try {
				await Promise.all([api?.close(), app?.close()]);
			} finally {
				if (originalMongo === undefined) delete process.env.MONGO_DEV;
				else process.env.MONGO_DEV = originalMongo;
				if (originalEnabled === undefined) delete process.env.BATCH_BOOKING_EXPIRY_ENABLED;
				else process.env.BATCH_BOOKING_EXPIRY_ENABLED = originalEnabled;
			}
		}
	});

	async function fixture(
		status = 'CONFIRMED',
		payment = 'UNPAID',
		tourStatus = 'ACTIVE',
		selectedDate = new Date(Date.now() - 3600000),
	) {
		const id = new Types.ObjectId();
		const tourId = new Types.ObjectId();
		const dateId = new Types.ObjectId();
		const available = status === 'CONFIRMED' ? 0 : 2;
		const tours = connection.collection('tours');
		await tours.insertOne({
			_id: tourId,
			tourSlug: `disposable-expiry-${tourId.toHexString()}`,
			agentId,
			tourStatus,
			tourAvailableSeats: available,
			tourBookingCount: status === 'CONFIRMED' ? 1 : 0,
			tourAvailableDates: [
				{
					_id: dateId,
					startDate: selectedDate,
					endDate: new Date(selectedDate.getTime() + 60000),
					availableSeats: available,
				},
			],
		});
		const bookings = connection.collection('bookings');
		await bookings.insertOne({
			_id: id,
			bookingCode: `DISPOSABLE-${id.toHexString()}`,
			userId,
			agentId,
			tourId,
			tourDateId: dateId,
			selectedDate,
			numberOfPeople: 2,
			unitPrice: 10,
			totalPrice: 20,
			bookingStatus: status,
			paymentStatus: payment,
		});
		return { id, tourId, dateId };
	}
	const snapshots = async () => ({
		bookings: await connection.collection('bookings').find().sort({ _id: 1 }).toArray(),
		tours: await connection.collection('tours').find().sort({ _id: 1 }).toArray(),
		members: await connection.collection('members').find().sort({ _id: 1 }).toArray(),
	});

	it('expires pending and confirmed bookings, reopens SOLD_OUT, and preserves CANCELLED tours', async () => {
		const pending = await fixture('PENDING');
		const confirmed = await Promise.all(
			['ACTIVE', 'SOLD_OUT', 'CANCELLED'].map((status) => fixture('CONFIRMED', 'UNPAID', status)),
		);
		const before = await snapshots();
		expect(await worker.runBookingExpiry()).toMatchObject({ scanned: 4, expired: 4, skipped: 0 });
		for (let index = 0; index < confirmed.length; index++) {
			expect(await connection.collection('tours').findOne({ _id: confirmed[index].tourId })).toMatchObject({
				tourAvailableSeats: 2,
				tourBookingCount: 0,
				tourStatus: index === 2 ? 'CANCELLED' : 'ACTIVE',
				tourAvailableDates: [{ _id: confirmed[index].dateId, availableSeats: 2 }],
			});
		}
		expect(await connection.collection('tours').findOne({ _id: pending.tourId })).toEqual(
			before.tours.find((tour) => tour._id.equals(pending.tourId)),
		);
		const after = await snapshots();
		expect(after.members).toEqual(before.members);
		for (const booking of after.bookings)
			expect(booking).toMatchObject({
				bookingStatus: 'CANCELLED',
				paymentStatus: 'UNPAID',
				cancellationReason: 'Expired unpaid booking after departure.',
				cancelledAt: expect.any(Date) as unknown,
			});
		expect((await worker.runBookingExpiry()).expired).toBe(0);
		expect(await snapshots()).toEqual(after);
	});

	it('does not alter paid, refunded, terminal or future bookings', async () => {
		for (const payment of ['PAID', 'REFUNDED']) await fixture('CONFIRMED', payment);
		for (const status of ['CANCELLED', 'REJECTED', 'COMPLETED']) await fixture(status);
		for (const status of ['PENDING', 'CONFIRMED'])
			await fixture(status, 'UNPAID', 'ACTIVE', new Date(Date.now() + 3600000));
		const before = await snapshots();
		expect((await worker.runBookingExpiry()).scanned).toBe(0);
		expect(await snapshots()).toEqual(before);
	});

	it('accepts the exact cutoff and rejects a departure one millisecond later', async () => {
		const cutoff = new Date(Date.now() - 10000);
		const due = await fixture('PENDING', 'UNPAID', 'ACTIVE', cutoff);
		const future = await fixture('PENDING', 'UNPAID', 'ACTIVE', new Date(cutoff.getTime() + 1));
		await expiry.expireBooking(due.id.toHexString(), cutoff);
		const before = await snapshots();
		await expect(expiry.expireBooking(future.id.toHexString(), cutoff)).rejects.toThrow('before its departure');
		expect(await snapshots()).toEqual(before);
	});

	it('settles without requiring an active account or an admin token', async () => {
		const disabledId = new Types.ObjectId();
		await connection
			.collection('members')
			.insertOne({ _id: disabledId, memberNick: 'disposable-disabled', memberStatus: 'BLOCK', memberType: 'USER' });
		const blocked = await fixture('PENDING');
		const deleted = await fixture('CONFIRMED');
		await connection.collection('bookings').updateOne({ _id: blocked.id }, { $set: { userId: disabledId } });
		await connection.collection('bookings').updateOne({ _id: deleted.id }, { $set: { userId: new Types.ObjectId() } });
		const before = await snapshots();
		expect((await worker.runBookingExpiry()).expired).toBe(2);
		expect((await snapshots()).members).toEqual(before.members);
	});

	it('skips inconsistent tours and continues to a valid booking without partial writes', async () => {
		const bad = await fixture();
		await connection.collection('tours').updateOne({ _id: bad.tourId }, { $set: { tourBookingCount: 0 } });
		const valid = await fixture('PENDING');
		const before = await snapshots();
		expect(await worker.runBookingExpiry()).toMatchObject({ scanned: 2, expired: 1, skipped: 1 });
		expect(await connection.collection('bookings').findOne({ _id: bad.id })).toEqual(
			before.bookings.find((row) => row._id.equals(bad.id)),
		);
		expect(await connection.collection('tours').findOne({ _id: bad.tourId })).toEqual(
			before.tours.find((row) => row._id.equals(bad.tourId)),
		);
		expect(await connection.collection('bookings').findOne({ _id: valid.id })).toMatchObject({
			bookingStatus: 'CANCELLED',
		});
	});

	it('uses real pages beyond 100 candidates and the expiry index', async () => {
		const base = await fixture('PENDING');
		const source = await connection.collection('bookings').findOne({ _id: base.id });
		if (!source) throw new Error('Missing disposable fixture');
		await connection.collection('bookings').insertMany(
			Array.from({ length: 100 }, () => {
				const _id = new Types.ObjectId();
				return { ...source, _id, bookingCode: `DISPOSABLE-${_id.toHexString()}` };
			}),
		);
		expect((await worker.runBookingExpiry()).expired).toBe(101);
		expect(await connection.collection('bookings').countDocuments({ bookingStatus: 'CANCELLED' })).toBe(101);
		const indexes = await connection.collection('bookings').indexes();
		expect(
			indexes.some(
				(index) =>
					JSON.stringify(index.key) === JSON.stringify({ paymentStatus: 1, bookingStatus: 1, selectedDate: 1, _id: 1 }),
			),
		).toBe(true);
	});

	it('rolls back seat restoration after an injected final-write failure and retries', async () => {
		await fixture();
		const before = await snapshots();
		const write = jest.spyOn(model, 'findOneAndUpdate').mockImplementationOnce(() => {
			throw new Error('Injected database failure');
		});
		await expect(worker.runBookingExpiry()).rejects.toBeInstanceOf(InternalServerErrorException);
		expect(await snapshots()).toEqual(before);
		write.mockRestore();
		expect((await worker.runBookingExpiry()).expired).toBe(1);
	});

	it('independent workers and live admin expiry restore seats exactly once', async () => {
		const target = await fixture('CONFIRMED', 'UNPAID', 'SOLD_OUT');
		const [first, second, response] = await Promise.all([
			worker.runBookingExpiry(),
			newWorker().runBookingExpiry(),
			request(api.getHttpServer())
				.post('/graphql')
				.set('Authorization', `Bearer ${adminToken}`)
				.send({
					query: 'mutation($input: String!) { expireBookingByAdmin(bookingId: $input) { bookingStatus } }',
					variables: { input: target.id.toHexString() },
				}),
		]);
		const body = response.body as GraphResponse;
		expect(first.expired + second.expired + (body.data?.expireBookingByAdmin ? 1 : 0)).toBe(1);
		expect(await connection.collection('tours').findOne({ _id: target.tourId })).toMatchObject({
			tourAvailableSeats: 2,
			tourBookingCount: 0,
			tourStatus: 'ACTIVE',
		});
		expect(await connection.collection('bookings').findOne({ _id: target.id })).toMatchObject({
			bookingStatus: 'CANCELLED',
		});
	});

	it('registered cron callback runs the real worker only when opted in', async () => {
		await fixture('PENDING');
		const configured = app.get(ConfigService);
		jest.spyOn(configured, 'get').mockReturnValue('true');
		const registered = app.get<BatchService>(BatchService);
		const original = registered.runBookingExpiry.bind(registered) as () => ReturnType<BatchService['runBookingExpiry']>;
		let done: () => void = () => undefined;
		const completed = new Promise<void>((resolve) => {
			done = resolve;
		});
		jest.spyOn(registered, 'runBookingExpiry').mockImplementation(async () => {
			try {
				return await original();
			} finally {
				done();
			}
		});
		void app.get(SchedulerRegistry).getCronJob(BOOKING_EXPIRY_JOB).fireOnTick();
		await completed;
		expect(await connection.collection('bookings').countDocuments({ bookingStatus: 'CANCELLED' })).toBe(1);
	});

	it('rejects live payment while workers settle an overdue booking without double restoration', async () => {
		const target = await fixture();
		const token = await api
			.get<AuthService>(AuthService)
			.createToken({ _id: userId, memberType: MemberType.USER, memberNick: 'disposable-expiry-user' });
		const [first, second, payment] = await Promise.all([
			worker.runBookingExpiry(),
			newWorker().runBookingExpiry(),
			request(api.getHttpServer())
				.post('/graphql')
				.set('Authorization', `Bearer ${token}`)
				.send({
					query: 'mutation($input: String!) { payBooking(bookingId: $input) { bookingStatus } }',
					variables: { input: target.id.toHexString() },
				}),
		]);
		expect(first.expired + second.expired).toBe(1);
		expect((payment.body as GraphResponse).errors).toBeDefined();
		expect(await connection.collection('bookings').findOne({ _id: target.id })).toMatchObject({
			bookingStatus: 'CANCELLED',
			paymentStatus: 'UNPAID',
		});
		expect(await connection.collection('tours').findOne({ _id: target.tourId })).toMatchObject({
			tourAvailableSeats: 2,
			tourBookingCount: 0,
		});
	});

	it('revisits newly due candidates after a completed sweep', async () => {
		await fixture('PENDING');
		expect((await worker.runBookingExpiry()).expired).toBe(1);
		await fixture('PENDING', 'UNPAID', 'ACTIVE', new Date(Date.now() - 7200000));
		expect((await worker.runBookingExpiry()).expired).toBe(1);
	});

	it('expiry wins against payment paused across the actual departure deadline', async () => {
		const departure = new Date(Date.now() + 5000);
		const target = await fixture('CONFIRMED', 'UNPAID', 'ACTIVE', departure);
		const token = await api
			.get<AuthService>(AuthService)
			.createToken({ _id: userId, memberType: MemberType.USER, memberNick: 'disposable-expiry-user' });
		const tourModel = api.get<Model<object>>(getModelToken('Tour')) as unknown as TourEligibilityModel;
		const original = tourModel.updateOne.bind(tourModel) as TourEligibilityModel['updateOne'];
		let release: () => void = () => undefined;
		let started: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		jest.spyOn(tourModel, 'updateOne').mockImplementationOnce((filter, update, options) => {
			const query = original(filter, update, options);
			const execute = query.exec.bind(query) as typeof query.exec;
			jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
				started();
				await gate;
				return execute();
			});
			return query;
		});
		const payment = request(api.getHttpServer())
			.post('/graphql')
			.set('Authorization', `Bearer ${token}`)
			.send({
				query: 'mutation($input: String!) { payBooking(bookingId: $input) { bookingStatus } }',
				variables: { input: target.id.toHexString() },
			})
			.then((response) => response);
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				ready,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error('Payment did not reach the controlled transaction barrier')),
						15000,
					);
				}),
			]);
			clearTimeout(timeout);
			await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, departure.getTime() - Date.now() + 50)));
			expect((await worker.runBookingExpiry()).expired).toBe(1);
		} finally {
			clearTimeout(timeout);
			release();
			await payment;
		}
		expect(((await payment).body as GraphResponse).errors).toBeDefined();
		expect(await connection.collection('bookings').findOne({ _id: target.id })).toMatchObject({
			bookingStatus: 'CANCELLED',
			paymentStatus: 'UNPAID',
		});
		expect(await connection.collection('tours').findOne({ _id: target.tourId })).toMatchObject({
			tourAvailableSeats: 2,
			tourBookingCount: 0,
		});
	});
});
