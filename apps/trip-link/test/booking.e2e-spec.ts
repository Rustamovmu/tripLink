import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/components/auth/auth.service';
import { BookingService } from './../src/components/booking/booking.service';
import { MemberType } from './../src/libs/enums/member.enum';

jest.setTimeout(30000);

type Response<T> = { data?: T | null; errors?: Array<{ message: string; extensions?: { code?: string } }> };
type Actor = { id: string; token: string };
type BookingResult = { _id: string; bookingStatus: string; paymentStatus: string; totalPrice: number };
type Fixture = { id: string; dateId: string; startDate: Date; endDate: Date };
type StoredTour = {
	_id: Types.ObjectId;
	tourAvailableSeats: number;
	tourBookingCount: number;
	tourStatus: string;
	tourFeatured: boolean;
	updatedAt: Date;
	__v?: number;
	tourAvailableDates: Array<{ _id: Types.ObjectId; availableSeats: number }>;
};
type StoredBooking = {
	_id: Types.ObjectId;
	tourId: Types.ObjectId;
	bookingStatus: string;
	paymentStatus: string;
	paymentReference?: string;
	paidAt?: Date;
	refundReference?: string;
	cancelledAt?: Date;
};
// Narrow Mongoose's overloaded method to the signature intercepted in the eligibility-write test.
type TourEligibilityModel = {
	updateOne(
		filter: { _id: Types.ObjectId; tourStatus: { $in: string[] } },
		update: { $inc: { __v: number } },
		options: { session: ClientSession; timestamps: boolean },
	): ReturnType<Model<StoredTour>['updateOne']>;
};

describe('Booking lifecycle and availability (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let originalMongoDev: string | undefined;
	let testDatabase: string;
	let user: Actor;
	let otherUser: Actor;
	let agent: Actor;
	let otherAgent: Actor;
	let adminToken: string;

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Booking tests cannot run in production');
		originalMongoDev = process.env.MONGO_DEV;
		if (!originalMongoDev) throw new Error('MONGO_DEV is required for booking e2e tests');
		testDatabase = `tl_bk_e2e_${new Types.ObjectId().toHexString()}`;
		const mongoUrl = new URL(originalMongoDev);
		mongoUrl.pathname = `/${testDatabase}`;
		process.env.MONGO_DEV = mongoUrl.toString();
		const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = moduleFixture.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.init();
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== testDatabase) throw new Error('Unexpected test database');
		const suffix = new Types.ObjectId().toHexString().slice(-8);
		user = await signup(`user-${suffix}`, MemberType.USER);
		otherUser = await signup(`other-user-${suffix}`, MemberType.USER);
		agent = await signup(`agent-${suffix}`, MemberType.AGENT);
		otherAgent = await signup(`other-agent-${suffix}`, MemberType.AGENT);
		const adminId = new Types.ObjectId();
		// Real disposable admin account; no development member is promoted or modified.
		await connection.collection('members').insertOne({
			_id: adminId,
			memberType: MemberType.ADMIN,
			memberStatus: 'ACTIVE',
			memberNick: `admin-${suffix}`,
			memberPassword: await app.get(AuthService).hashPassword('TestPass123!'),
		});
		adminToken = await app.get(AuthService).createToken({
			_id: adminId,
			memberType: MemberType.ADMIN,
			memberNick: `admin-${suffix}`,
		});
	});

	afterAll(async () => {
		try {
			if (connection && connection.name === testDatabase) await connection.dropDatabase();
		} finally {
			if (app) await app.close();
			if (originalMongoDev) process.env.MONGO_DEV = originalMongoDev;
			else delete process.env.MONGO_DEV;
		}
	});

	it('reserves seats once on confirmation and restores them once on unpaid cancellation', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 2);
		expect(booking).toMatchObject({ bookingStatus: 'PENDING', paymentStatus: 'UNPAID', totalPrice: 160 });
		await expectSeats(tour, 2, 0, 'ACTIVE');
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).data?.confirmBooking.bookingStatus).toBe(
			'CONFIRMED',
		);
		await expectSeats(tour, 0, 1, 'SOLD_OUT');
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeDefined();
		await expectSeats(tour, 0, 1, 'SOLD_OUT');
		const cancelled = await cancel(booking._id, user.token);
		expect(cancelled.data?.cancelBooking.bookingStatus).toBe('CANCELLED');
		await expectSeats(tour, 2, 0, 'ACTIVE');
		expect((await cancel(booking._id, user.token)).errors).toBeDefined();
		await expectSeats(tour, 2, 0, 'ACTIVE');
	});

	it('cancels or rejects pending bookings without changing seats', async () => {
		const tour = await createTour(3);
		const cancelled = await createBooking(tour, 1);
		expect((await cancel(cancelled._id, user.token)).errors).toBeUndefined();
		const rejected = await createBooking(tour, 1);
		const result = await inputAction(
			'rejectBooking',
			'BookingRejectionInput',
			{
				bookingId: rejected._id,
				rejectionReason: 'Test rejection',
			},
			agent.token,
		);
		expect(result.data?.rejectBooking.bookingStatus).toBe('REJECTED');
		expect((await bookingAction('confirmBooking', rejected._id, agent.token)).errors).toBeDefined();
		await expectSeats(tour, 3, 0, 'ACTIVE');
	});

	it('simulates payment and refunds once without double-restoring seats', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 2);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		expect((await bookingAction('payBooking', booking._id, user.token)).data?.payBooking.paymentStatus).toBe('PAID');
		expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeDefined();
		expect((await cancel(booking._id, user.token)).errors).toBeDefined();
		await expectSeats(tour, 0, 1, 'SOLD_OUT');
		const input = { bookingId: booking._id, refundReason: 'Test simulated refund' };
		expect((await inputAction('refundBookingByAdmin', 'BookingRefundInput', input, user.token)).errors).toBeDefined();
		const refunded = await inputAction('refundBookingByAdmin', 'BookingRefundInput', input, adminToken);
		expect(refunded.errors).toBeUndefined();
		expect(refunded.data?.refundBookingByAdmin).toMatchObject({
			bookingStatus: 'CANCELLED',
			paymentStatus: 'REFUNDED',
		});
		await expectSeats(tour, 2, 0, 'ACTIVE');
		expect((await inputAction('refundBookingByAdmin', 'BookingRefundInput', input, adminToken)).errors).toBeDefined();
		await expectSeats(tour, 2, 0, 'ACTIVE');
	});

	it('commits only one payment when duplicate payment requests race', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		const before = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		const results = await Promise.all([
			bookingAction('payBooking', booking._id, user.token),
			bookingAction('payBooking', booking._id, user.token),
		]);
		expect(results.filter((result) => result.data?.payBooking)).toHaveLength(1);
		expect(results.filter((result) => result.errors?.length)).toHaveLength(1);
		const stored = await storedBooking(booking._id);
		expect(stored).toMatchObject({ bookingStatus: 'CONFIRMED', paymentStatus: 'PAID' });
		expect(stored?.paymentReference).toMatch(/^PAY-/);
		expect(stored?.paidAt).toBeInstanceOf(Date);
		const after = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		expect(after?.__v).toBe((before?.__v ?? 0) + 1);
		expect(after?.updatedAt).toEqual(before?.updatedAt);
		await expectSeats(tour, 1, 1, 'ACTIVE');
	});

	it('commits either payment or unpaid cancellation without mixing their states', async () => {
		for (let attempt = 0; attempt < 3; attempt++) {
			const tour = await createTour(1);
			const booking = await createBooking(tour, 1);
			expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
			const [paid, cancelled] = await Promise.all([
				bookingAction('payBooking', booking._id, user.token),
				cancel(booking._id, user.token),
			]);
			expect([paid, cancelled].filter((result) => result.data)).toHaveLength(1);
			expect([paid, cancelled].filter((result) => result.errors?.length)).toHaveLength(1);
			const stored = await storedBooking(booking._id);
			if (paid.data?.payBooking) {
				expect(stored).toMatchObject({ bookingStatus: 'CONFIRMED', paymentStatus: 'PAID' });
				await expectSeats(tour, 0, 1, 'SOLD_OUT');
			} else {
				expect(stored).toMatchObject({ bookingStatus: 'CANCELLED', paymentStatus: 'UNPAID' });
				expect(stored?.paymentReference).toBeUndefined();
				await expectSeats(tour, 1, 0, 'ACTIVE');
			}
		}
	});

	it('restores seats only once when unpaid cancellations race', async () => {
		const tour = await createTour(1);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		const results = await Promise.all([cancel(booking._id, user.token), cancel(booking._id, user.token)]);
		expect(results.filter((result) => result.data?.cancelBooking)).toHaveLength(1);
		expect(results.filter((result) => result.errors?.length)).toHaveLength(1);
		expect(await storedBooking(booking._id)).toMatchObject({ bookingStatus: 'CANCELLED', paymentStatus: 'UNPAID' });
		await expectSeats(tour, 1, 0, 'ACTIVE');
	});

	it('restores seats and records a refund only once when refund requests race', async () => {
		const tour = await createTour(1);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeUndefined();
		const input = { bookingId: booking._id, refundReason: 'Concurrent simulated refund test' };
		const results = await Promise.all([
			inputAction('refundBookingByAdmin', 'BookingRefundInput', input, adminToken),
			inputAction('refundBookingByAdmin', 'BookingRefundInput', input, adminToken),
		]);
		expect(results.filter((result) => result.data?.refundBookingByAdmin)).toHaveLength(1);
		expect(results.filter((result) => result.errors?.length)).toHaveLength(1);
		const stored = await storedBooking(booking._id);
		expect(stored).toMatchObject({ bookingStatus: 'CANCELLED', paymentStatus: 'REFUNDED' });
		expect(stored?.refundReference).toMatch(/^REF-/);
		await expectSeats(tour, 1, 0, 'ACTIVE');
	});

	it('rejects payment if tour cancellation commits after the booking read but before the eligibility write', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		const tourModel = app.get<Model<StoredTour>>(getModelToken('Tour')) as unknown as TourEligibilityModel;
		const originalUpdate = tourModel.updateOne.bind(tourModel) as TourEligibilityModel['updateOne'];
		const before = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		let cancellationCommitted = false;
		// Pause only the first eligibility write; cancellation and all database writes remain real.
		const spy = jest.spyOn(tourModel, 'updateOne').mockImplementationOnce((filter, update, options) => {
			const query = originalUpdate(filter, update, options);
			const execute = query.exec.bind(query) as typeof query.exec;
			jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
				const cancelled = await updateTour({ tourId: tour.id, tourStatus: 'CANCELLED' });
				expect(cancelled.errors).toBeUndefined();
				cancellationCommitted = true;
				return execute();
			});
			return query;
		});
		try {
			const paid = await bookingAction('payBooking', booking._id, user.token);
			expect(cancellationCommitted).toBe(true);
			expect(paid.errors?.[0].extensions?.code).toBe('BAD_REQUEST');
			expect(await storedBooking(booking._id)).toMatchObject({ bookingStatus: 'CONFIRMED', paymentStatus: 'UNPAID' });
			expect((await storedBooking(booking._id))?.paymentReference).toBeUndefined();
			const after = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
			expect(after?.__v).toBe(before?.__v);
			await expectSeats(tour, 1, 1, 'CANCELLED');
		} finally {
			spy.mockRestore();
		}
		expect((await cancel(booking._id, user.token)).errors).toBeUndefined();
		await expectSeats(tour, 2, 0, 'CANCELLED');
	});

	it('enforces ownership and role restrictions without changing bookings or seats', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, otherAgent.token)).errors).toBeDefined();
		expect((await bookingAction('confirmBooking', booking._id, user.token)).errors).toBeDefined();
		expect((await cancel(booking._id, otherUser.token)).errors).toBeDefined();
		await expectSeats(tour, 2, 0, 'ACTIVE');
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		expect((await bookingAction('payBooking', booking._id, otherUser.token)).errors).toBeDefined();
		expect((await bookingAction('completeBooking', booking._id, otherAgent.token)).errors).toBeDefined();
		await expectSeats(tour, 1, 1, 'ACTIVE');
	});

	it('does not oversell the final seat when confirmations race', async () => {
		const tour = await createTour(1);
		const first = await createBooking(tour, 1);
		const second = await createBooking(tour, 1);
		const results = await Promise.all([
			bookingAction('confirmBooking', first._id, agent.token),
			bookingAction('confirmBooking', second._id, agent.token),
		]);
		expect(results.filter((result) => result.data?.confirmBooking)).toHaveLength(1);
		expect(results.filter((result) => result.errors?.length)).toHaveLength(1);
		await expectSeats(tour, 0, 1, 'SOLD_OUT');
		const statuses = await connection
			.collection<StoredBooking>('bookings')
			.find({ tourId: new Types.ObjectId(tour.id) })
			.toArray();
		expect(statuses.map((booking) => booking.bookingStatus).sort()).toEqual(['CONFIRMED', 'PENDING']);
	});

	it('rejects date and seat edits on published tours but permits descriptive edits', async () => {
		for (const status of ['ACTIVE', 'SOLD_OUT']) {
			const tour = await createTour(status === 'ACTIVE' ? 2 : 0, status);
			for (const availability of [
				{ tourAvailableSeats: 2 },
				{
					tourAvailableDates: [
						{ startDate: tour.startDate.toISOString(), endDate: tour.endDate.toISOString(), availableSeats: 2 },
					],
				},
			]) {
				const result = await updateTour({ tourId: tour.id, ...availability });
				expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
			}
			const edited = await updateTour({ tourId: tour.id, tourDescription: 'Updated public description' });
			expect(edited.errors).toBeUndefined();
			await expectSeats(tour, status === 'ACTIVE' ? 2 : 0, 0, status);
			const stored = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
			expect(stored?.tourAvailableDates[0]._id.toHexString()).toBe(tour.dateId);
		}
	});

	it('resubmits an active tour, hides it publicly, and requires admin approval to publish again', async () => {
		const tour = await createTour(2);
		const pendingBooking = await createBooking(tour, 1);
		await connection
			.collection('tours')
			.updateOne({ _id: new Types.ObjectId(tour.id) }, { $set: { tourFeatured: true } });
		const resubmitted = await updateTour({ tourId: tour.id, tourStatus: 'PENDING', tourTitle: 'Resubmitted tour' });
		expect(resubmitted.errors).toBeUndefined();
		await expectSeats(tour, 2, 0, 'PENDING');
		const stored = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		expect(stored?.tourFeatured).toBe(false);
		expect(stored?.tourAvailableDates[0]._id.toHexString()).toBe(tour.dateId);
		const detail = await graphql('query Detail($tourId: String!) { getTour(tourId: $tourId) { _id } }', {
			tourId: tour.id,
		});
		expect(detail.errors).toBeDefined();
		const list = await graphql<{ getTours: { list: Array<{ _id: string }> } }>(
			'query Tours($input: ToursInquiry!) { getTours(input: $input) { list { _id } } }',
			{ input: { page: 1, limit: 100, search: {} } },
		);
		expect(list.errors).toBeUndefined();
		expect(list.data?.getTours.list.some((item) => item._id === tour.id)).toBe(false);
		expect((await bookingAction('confirmBooking', pendingBooking._id, agent.token)).errors).toBeDefined();
		expect((await updateTour({ tourId: tour.id, tourStatus: 'ACTIVE' })).errors?.[0].extensions?.code).toBe(
			'FORBIDDEN',
		);
		const published = await graphql(
			'mutation Approve($input: TourAdminUpdate!) { updateTourByAdmin(input: $input) { _id tourStatus } }',
			{ input: { tourId: tour.id, tourStatus: 'ACTIVE' } },
			adminToken,
		);
		expect(published.errors).toBeUndefined();
		expect((await bookingAction('confirmBooking', pendingBooking._id, agent.token)).errors).toBeUndefined();
		await expectSeats(tour, 1, 1, 'ACTIVE');
	});

	it('rejects re-approval requests by other agents and preserves existing status restrictions', async () => {
		const tour = await createTour(2);
		expect((await updateTour({ tourId: tour.id, tourStatus: 'PENDING' }, otherAgent.token)).errors).toBeDefined();
		expect(
			(await updateTour({ tourId: tour.id, tourStatus: 'PENDING' }, user.token)).errors?.[0].extensions?.code,
		).toBe('FORBIDDEN');
		await expectSeats(tour, 2, 0, 'ACTIVE');
		for (const status of ['SOLD_OUT', 'COMPLETED', 'CANCELLED']) {
			const restricted = await createTour(status === 'SOLD_OUT' ? 0 : 2, status);
			expect((await updateTour({ tourId: restricted.id, tourStatus: 'PENDING' })).errors?.[0].extensions?.code).toBe(
				'FORBIDDEN',
			);
			await expectSeats(restricted, status === 'SOLD_OUT' ? 0 : 2, 0, status);
		}
	});

	it('blocks re-approval for unpaid and paid confirmed bookings without stranding cancellation or refund', async () => {
		for (const paid of [false, true]) {
			const tour = await createTour(2);
			const booking = await createBooking(tour, 1);
			expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
			if (paid) expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeUndefined();
			const blocked = await updateTour({ tourId: tour.id, tourStatus: 'PENDING' });
			expect(blocked.errors?.[0].extensions?.code).toBe('CONFLICT');
			expect(blocked.errors?.[0].message).toBe('Cannot resubmit a tour with confirmed bookings.');
			await expectSeats(tour, 1, 1, 'ACTIVE');
			const cancelled = paid
				? await inputAction(
						'refundBookingByAdmin',
						'BookingRefundInput',
						{ bookingId: booking._id, refundReason: 'Test refund before re-approval' },
						adminToken,
					)
				: await cancel(booking._id, user.token);
			expect(cancelled.errors).toBeUndefined();
			expect((await updateTour({ tourId: tour.id, tourStatus: 'PENDING' })).errors).toBeUndefined();
			await expectSeats(tour, 2, 0, 'PENDING');
		}
	});

	it('does not commit re-approval and booking confirmation together when they race', async () => {
		for (let attempt = 0; attempt < 3; attempt++) {
			const tour = await createTour(2);
			const booking = await createBooking(tour, 1);
			const [resubmitted, confirmed] = await Promise.all([
				updateTour({ tourId: tour.id, tourStatus: 'PENDING' }),
				bookingAction('confirmBooking', booking._id, agent.token),
			]);
			expect([resubmitted, confirmed].filter((result) => result.errors?.length)).toHaveLength(1);
			expect([resubmitted, confirmed].filter((result) => result.data)).toHaveLength(1);
			const stored = await connection
				.collection<StoredBooking>('bookings')
				.findOne({ _id: new Types.ObjectId(booking._id) });
			if (resubmitted.data?.updateTour) {
				await expectSeats(tour, 2, 0, 'PENDING');
				expect(stored?.bookingStatus).toBe('PENDING');
			} else {
				await expectSeats(tour, 1, 1, 'ACTIVE');
				expect(stored?.bookingStatus).toBe('CONFIRMED');
			}
		}
	});

	it('permits coherent availability edits before publication', async () => {
		for (const status of ['DRAFT', 'PENDING']) {
			const tour = await createTour(2, status);
			const edited = await updateTour({
				tourId: tour.id,
				tourAvailableSeats: 3,
				tourAvailableDates: [
					{ startDate: tour.startDate.toISOString(), endDate: tour.endDate.toISOString(), availableSeats: 3 },
				],
			});
			expect(edited.errors).toBeUndefined();
			const stored = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
			expect(stored?.tourAvailableSeats).toBe(3);
			expect(stored?.tourAvailableDates[0].availableSeats).toBe(3);
		}
	});

	it('completes only a paid booking after its end date without releasing consumed seats', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		expect((await bookingAction('completeBooking', booking._id, agent.token)).errors).toBeDefined();
		expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeUndefined();
		expect((await bookingAction('completeBooking', booking._id, agent.token)).errors).toBeDefined();
		// Advance only this isolated fixture's dates; no clock or development records are changed.
		await connection.collection('bookings').updateOne(
			{ _id: new Types.ObjectId(booking._id) },
			{
				$set: { selectedDate: new Date(Date.now() - 172800000), selectedEndDate: new Date(Date.now() - 86400000) },
			},
		);
		expect((await bookingAction('completeBooking', booking._id, agent.token)).data?.completeBooking.bookingStatus).toBe(
			'COMPLETED',
		);
		expect((await bookingAction('completeBooking', booking._id, agent.token)).errors).toBeDefined();
		await expectSeats(tour, 1, 1, 'ACTIVE');
	});

	it('rejects admin completion while any departure is still running or upcoming', async () => {
		for (const status of ['ACTIVE', 'SOLD_OUT']) {
			const tour = await createTour(status === 'ACTIVE' ? 2 : 0, status);
			const blocked = await adminUpdate({ tourId: tour.id, tourStatus: 'COMPLETED' });
			expect(blocked.errors?.[0].extensions?.code).toBe('CONFLICT');
			expect(blocked.errors?.[0].message).toBe('Cannot complete a tour before all departures have ended.');
			await expectSeats(tour, status === 'ACTIVE' ? 2 : 0, 0, status);
		}
	});

	it('blocks admin completion for pending, unpaid confirmed, and paid confirmed bookings after departures end', async () => {
		for (const state of ['PENDING', 'UNPAID', 'PAID']) {
			const tour = await createTour(2);
			const booking = await createBooking(tour, 1);
			if (state !== 'PENDING') {
				expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
			}
			if (state === 'PAID') expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeUndefined();
			await endDepartures(tour);
			const blocked = await adminUpdate({ tourId: tour.id, tourStatus: 'COMPLETED', tourFeatured: true });
			expect(blocked.errors?.[0].extensions?.code).toBe('CONFLICT');
			expect(blocked.errors?.[0].message).toBe('Cannot complete a tour with unsettled bookings.');
			await expectSeats(tour, state === 'PENDING' ? 2 : 1, state === 'PENDING' ? 0 : 1, 'ACTIVE');
			expect(await storedBooking(booking._id)).toMatchObject({
				bookingStatus: state === 'PENDING' ? 'PENDING' : 'CONFIRMED',
				paymentStatus: state === 'PAID' ? 'PAID' : 'UNPAID',
			});
		}
	});

	it('allows admin completion after departures end and bookings are settled without releasing consumed seats', async () => {
		const tour = await createTour(1);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeUndefined();
		await endDepartures(tour);
		await connection
			.collection('bookings')
			.updateOne(
				{ _id: new Types.ObjectId(booking._id) },
				{ $set: { selectedDate: new Date(Date.now() - 172800000), selectedEndDate: new Date(Date.now() - 86400000) } },
			);
		expect((await bookingAction('completeBooking', booking._id, agent.token)).errors).toBeUndefined();
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'COMPLETED' })).errors).toBeUndefined();
		await expectSeats(tour, 0, 1, 'COMPLETED');
		expect(await storedBooking(booking._id)).toMatchObject({ bookingStatus: 'COMPLETED', paymentStatus: 'PAID' });
		const emptyTour = await createTour(2);
		await endDepartures(emptyTour);
		expect((await adminUpdate({ tourId: emptyTour.id, tourStatus: 'COMPLETED' })).errors).toBeUndefined();
		await expectSeats(emptyTour, 2, 0, 'COMPLETED');
	});

	it('requires an admin token for tour status changes', async () => {
		const tour = await createTour(2);
		for (const token of [user.token, agent.token]) {
			expect(
				(await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' }, token)).errors?.[0].extensions?.code,
			).toBe('FORBIDDEN');
		}
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' }, '')).errors?.[0].extensions?.code).toBe(
			'UNAUTHENTICATED',
		);
		await expectSeats(tour, 2, 0, 'ACTIVE');
	});

	it('preserves manual cancellation and refund after admin tour cancellation', async () => {
		for (const paid of [false, true]) {
			const tour = await createTour(1);
			const booking = await createBooking(tour, 1);
			expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
			if (paid) expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeUndefined();
			expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' })).errors).toBeUndefined();
			await expectSeats(tour, 0, 1, 'CANCELLED');
			expect(await storedBooking(booking._id)).toMatchObject({
				bookingStatus: 'CONFIRMED',
				paymentStatus: paid ? 'PAID' : 'UNPAID',
			});
			const settled = paid
				? await inputAction(
						'refundBookingByAdmin',
						'BookingRefundInput',
						{ bookingId: booking._id, refundReason: 'Cancelled tour refund' },
						adminToken,
					)
				: await cancel(booking._id, user.token);
			expect(settled.errors).toBeUndefined();
			await expectSeats(tour, 1, 0, 'CANCELLED');
			expect(await storedBooking(booking._id)).toMatchObject({
				bookingStatus: 'CANCELLED',
				paymentStatus: paid ? 'REFUNDED' : 'UNPAID',
			});
		}
	});

	it('revalidates publication when a same-status availability edit commits after the admin read', async () => {
		const tour = await createTour(2, 'PENDING');
		const model = app.get<Model<StoredTour>>(getModelToken('Tour'));
		const original = model.findOneAndUpdate.bind(model) as typeof model.findOneAndUpdate;
		let editCommitted = false;
		// Intercept scheduling only; both writes and the transaction retry use the real database.
		const spy = jest
			.spyOn(model, 'findOneAndUpdate')
			.mockImplementationOnce((...args: Parameters<typeof model.findOneAndUpdate>) => {
				const query = original(...args);
				const execute = query.exec.bind(query) as typeof query.exec;
				jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
					await connection
						.collection('tours')
						.updateOne(
							{ _id: new Types.ObjectId(tour.id) },
							{ $set: { tourAvailableSeats: 0, 'tourAvailableDates.0.availableSeats': 0 } },
						);
					editCommitted = true;
					return execute();
				});
				return query;
			});
		try {
			const published = await adminUpdate({ tourId: tour.id, tourStatus: 'ACTIVE' });
			expect(editCommitted).toBe(true);
			expect(published.errors?.[0].extensions?.code).toBe('BAD_REQUEST');
			await expectSeats(tour, 0, 0, 'PENDING');
		} finally {
			spy.mockRestore();
		}
	});

	it('expires unpaid pending bookings without changing seats or member counters', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		await expireDates(tour, booking._id);
		const memberBefore = await connection.collection('members').findOne({ _id: new Types.ObjectId(user.id) });
		expect((await expire(booking._id)).data?.expireBookingByAdmin).toMatchObject({
			bookingStatus: 'CANCELLED',
			paymentStatus: 'UNPAID',
		});
		expect(await storedBooking(booking._id)).toMatchObject({
			cancellationReason: 'Expired unpaid booking after departure.',
		});
		expect((await storedBooking(booking._id))?.cancelledAt).toBeInstanceOf(Date);
		await expectSeats(tour, 2, 0, 'ACTIVE');
		expect(await connection.collection('members').findOne({ _id: new Types.ObjectId(user.id) })).toEqual(memberBefore);
		expect((await expire(booking._id)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
		await expectSeats(tour, 2, 0, 'ACTIVE');
	});

	it('restores confirmed expiry seats once on active, sold-out, and cancelled tours', async () => {
		for (const status of ['ACTIVE', 'SOLD_OUT', 'CANCELLED']) {
			const tour = await createTour(status === 'SOLD_OUT' ? 1 : 2);
			const booking = await createBooking(tour, 1);
			expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
			if (status === 'CANCELLED')
				expect((await adminUpdate({ tourId: tour.id, tourStatus: status })).errors).toBeUndefined();
			await expireDates(tour, booking._id);
			expect((await expire(booking._id)).errors).toBeUndefined();
			await expectSeats(tour, status === 'SOLD_OUT' ? 1 : 2, 0, status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE');
			expect((await expire(booking._id)).errors).toBeDefined();
			await expectSeats(tour, status === 'SOLD_OUT' ? 1 : 2, 0, status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE');
			if (status !== 'CANCELLED') {
				const newBooking = await inputAction(
					'createBooking',
					'BookingInput',
					{ tourId: tour.id, tourDateId: tour.dateId, numberOfPeople: 1 },
					user.token,
				);
				expect(newBooking.errors).toBeDefined();
			}
		}
	});

	it('rejects future, paid, terminal, missing, and invalid expiry targets without changing records', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		const before = await storedBooking(booking._id);
		expect((await expire(booking._id)).errors?.[0].extensions?.code).toBe('BAD_REQUEST');
		expect(await storedBooking(booking._id)).toEqual(before);
		expect((await expire('invalid')).errors?.[0].extensions?.code).toBe('BAD_REQUEST');
		expect((await expire(new Types.ObjectId().toHexString())).errors?.[0].extensions?.code).toBe('NOT_FOUND');
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeUndefined();
		await expireDates(tour, booking._id);
		for (const state of ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED']) {
			await connection
				.collection('bookings')
				.updateOne(
					{ _id: new Types.ObjectId(booking._id) },
					{ $set: { bookingStatus: state, paymentStatus: state === 'CONFIRMED' ? 'PAID' : 'UNPAID' } },
				);
			const stored = await storedBooking(booking._id);
			expect((await expire(booking._id)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
			expect(await storedBooking(booking._id)).toEqual(stored);
			await expectSeats(tour, 1, 1, 'ACTIVE');
		}
	});

	it('requires a current active admin token for expiry', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		await expireDates(tour, booking._id);
		for (const token of [user.token, agent.token])
			expect((await expire(booking._id, token)).errors?.[0].extensions?.code).toBe('FORBIDDEN');
		expect((await expire(booking._id, '')).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		const admin = await connection.collection('members').findOne({ memberType: MemberType.ADMIN });
		if (!admin) throw new Error('Missing disposable admin');
		await connection.collection('members').updateOne({ _id: admin._id }, { $set: { memberStatus: 'BLOCK' } });
		try {
			expect((await expire(booking._id)).errors?.[0].extensions?.code).toBe('FORBIDDEN');
			expect(await storedBooking(booking._id)).toMatchObject({ bookingStatus: 'PENDING' });
			await expectSeats(tour, 2, 0, 'ACTIVE');
		} finally {
			await connection.collection('members').updateOne({ _id: admin._id }, { $set: { memberStatus: 'ACTIVE' } });
		}
	});

	it('does not double-restore seats when expiry requests race', async () => {
		const tour = await createTour(1);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		await expireDates(tour, booking._id);
		const results = await Promise.all([expire(booking._id), expire(booking._id)]);
		expect(results.filter((result) => result.data?.expireBookingByAdmin)).toHaveLength(1);
		expect(results.filter((result) => result.errors?.length)).toHaveLength(1);
		await expectSeats(tour, 1, 0, 'ACTIVE');
	});

	it('rejects missing departures, unsupported tour statuses, and inconsistent counters atomically', async () => {
		for (const corruption of [
			{ tourAvailableDates: [] },
			{ tourBookingCount: 0 },
			{ tourAvailableSeats: 10 },
			{ tourStatus: 'COMPLETED' },
		]) {
			const tour = await createTour(2);
			const booking = await createBooking(tour, 1);
			expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
			await expireDates(tour, booking._id);
			await connection.collection('tours').updateOne({ _id: new Types.ObjectId(tour.id) }, { $set: corruption });
			const before = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
			expect((await expire(booking._id)).errors?.[0].extensions?.code).toBe('CONFLICT');
			expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual(before);
			expect(await storedBooking(booking._id)).toMatchObject({ bookingStatus: 'CONFIRMED', paymentStatus: 'UNPAID' });
		}
	});

	it('allows tour completion after all expired unpaid bookings have been settled', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		await expireDates(tour, booking._id);
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'COMPLETED' })).errors?.[0].extensions?.code).toBe(
			'CONFLICT',
		);
		expect((await expire(booking._id)).errors).toBeUndefined();
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'COMPLETED' })).errors).toBeUndefined();
		await expectSeats(tour, 2, 0, 'COMPLETED');
	});

	it('rejects payment when expiry commits after the payment read and rolls back its eligibility write', async () => {
		const tour = await createTour(2);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		const model = app.get<Model<StoredTour>>(getModelToken('Tour')) as unknown as TourEligibilityModel;
		const original = model.updateOne.bind(model) as TourEligibilityModel['updateOne'];
		let expired = false;
		// Schedule real expiry during payment; no database write or response is mocked.
		const spy = jest.spyOn(model, 'updateOne').mockImplementationOnce((filter, update, options) => {
			const query = original(filter, update, options);
			const execute = query.exec.bind(query) as typeof query.exec;
			jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
				await expireDates(tour, booking._id);
				expect((await expire(booking._id)).errors).toBeUndefined();
				expired = true;
				return execute();
			});
			return query;
		});
		try {
			const result = await bookingAction('payBooking', booking._id, user.token);
			expect(expired).toBe(true);
			expect(result.errors).toBeDefined();
			expect(await storedBooking(booking._id)).toMatchObject({ bookingStatus: 'CANCELLED', paymentStatus: 'UNPAID' });
			expect((await storedBooking(booking._id))?.paymentReference).toBeUndefined();
			await expectSeats(tour, 2, 0, 'ACTIVE');
		} finally {
			spy.mockRestore();
		}
	});

	it('rolls back restored seats when the booking changes before the final expiry write', async () => {
		const tour = await createTour(1);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		await expireDates(tour, booking._id);
		const before = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		const model = app.get<Model<StoredBooking>>(getModelToken('Booking'));
		const original = model.findOneAndUpdate.bind(model) as typeof model.findOneAndUpdate;
		let changed = false;
		// Inject a competing write to this disposable fixture after the transactional seat restoration.
		// This is a real MongoDB write used for fault injection, not a simulated payment API response.
		const spy = jest
			.spyOn(model, 'findOneAndUpdate')
			.mockImplementationOnce((...args: Parameters<typeof model.findOneAndUpdate>) => {
				const query = original(...args);
				const execute = query.exec.bind(query) as typeof query.exec;
				jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
					await connection
						.collection('bookings')
						.updateOne({ _id: new Types.ObjectId(booking._id) }, { $set: { paymentStatus: 'PAID' } });
					changed = true;
					return execute();
				});
				return query;
			});
		try {
			expect((await expire(booking._id)).errors).toBeDefined();
			expect(changed).toBe(true);
			expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual(before);
			expect(await storedBooking(booking._id)).toMatchObject({ bookingStatus: 'CONFIRMED', paymentStatus: 'PAID' });
			expect((await storedBooking(booking._id))?.cancelledAt).toBeUndefined();
		} finally {
			spy.mockRestore();
		}
	});

	it('refunds cancelled paid bookings after departure or end exactly once without reopening the tour', async () => {
		for (const ended of [false, true]) {
			const { tour, booking } = await paidFixture();
			await expireDates(tour, booking._id);
			if (!ended) {
				await connection
					.collection('bookings')
					.updateOne(
						{ _id: new Types.ObjectId(booking._id) },
						{ $set: { selectedEndDate: new Date(Date.now() + 86400000) } },
					);
			}
			expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' })).errors).toBeUndefined();
			const before = await storedBooking(booking._id);
			const tourBefore = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
			for (const token of [user.token, agent.token, '']) {
				expect((await refund(booking._id, token)).errors).toBeDefined();
			}
			expect((await bookingAction('completeBooking', booking._id, agent.token)).errors?.[0].extensions?.code).toBe(
				'BAD_REQUEST',
			);
			expect(await storedBooking(booking._id)).toEqual(before);
			expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual(tourBefore);
			const results = await Promise.all([refund(booking._id), refund(booking._id)]);
			expect(results.filter((result) => result.data?.refundBookingByAdmin)).toHaveLength(1);
			expect(await storedBooking(booking._id)).toMatchObject({ bookingStatus: 'CANCELLED', paymentStatus: 'REFUNDED' });
			expect((await storedBooking(booking._id))?.refundReference).toBeTruthy();
			await expectSeats(tour, 2, 0, 'CANCELLED');
			expect((await refund(booking._id)).errors).toBeDefined();
			await expectSeats(tour, 2, 0, 'CANCELLED');
		}
	});

	it('keeps departed ACTIVE and SOLD_OUT bookings ineligible for refunds', async () => {
		for (const seats of [1, 2]) {
			const { tour, booking } = await paidFixture(seats);
			await expireDates(tour, booking._id);
			const before = await storedBooking(booking._id);
			const tourBefore = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
			expect((await refund(booking._id)).errors).toBeDefined();
			expect(await storedBooking(booking._id)).toEqual(before);
			expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual(tourBefore);
		}
	});

	it('completes SOLD_OUT bookings using legacy end-date fallback without changing seats or public timestamp', async () => {
		const { tour, booking } = await paidFixture(1);
		await expireDates(tour, booking._id);
		await connection
			.collection('bookings')
			.updateOne({ _id: new Types.ObjectId(booking._id) }, { $unset: { selectedEndDate: '' } });
		const before = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		expect((await bookingAction('completeBooking', booking._id, agent.token)).errors).toBeUndefined();
		await expectSeats(tour, 0, 1, 'SOLD_OUT');
		const after = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		expect(after?.updatedAt).toEqual(before?.updatedAt);
		expect(after?.__v).toBe((before?.__v ?? 0) + 1);
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' })).errors).toBeUndefined();
		// A financial correction preserves the completed trip and consumed capacity.
		expect((await refund(booking._id)).data?.refundBookingByAdmin).toMatchObject({
			bookingStatus: 'COMPLETED',
			paymentStatus: 'REFUNDED',
		});
		await expectSeats(tour, 0, 1, 'CANCELLED');
	});

	it('rejects completion when cancellation commits before its tour write, including concurrent refund', async () => {
		for (const settle of [false, true]) {
			const { tour, booking } = await paidFixture();
			await expireDates(tour, booking._id);
			const model = app.get<Model<StoredTour>>(getModelToken('Tour')) as unknown as TourEligibilityModel;
			const original = model.updateOne.bind(model) as TourEligibilityModel['updateOne'];
			let cancelled = false;
			// Intercept scheduling only: cancellation, refund and completion all execute real MongoDB writes.
			const spy = jest.spyOn(model, 'updateOne').mockImplementationOnce((filter, update, options) => {
				const query = original(filter, update, options);
				const execute = query.exec.bind(query) as typeof query.exec;
				jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
					expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' })).errors).toBeUndefined();
					if (settle) expect((await refund(booking._id)).errors).toBeUndefined();
					cancelled = true;
					return execute();
				});
				return query;
			});
			try {
				expect((await bookingAction('completeBooking', booking._id, agent.token)).errors).toBeDefined();
				expect(cancelled).toBe(true);
				expect(await storedBooking(booking._id)).toMatchObject({
					bookingStatus: settle ? 'CANCELLED' : 'CONFIRMED',
					paymentStatus: settle ? 'REFUNDED' : 'PAID',
				});
				await expectSeats(tour, settle ? 2 : 1, settle ? 0 : 1, 'CANCELLED');
			} finally {
				spy.mockRestore();
			}
		}
	});

	it('rolls back refund seat restoration when its final booking write loses eligibility', async () => {
		const { tour, booking } = await paidFixture();
		await expireDates(tour, booking._id);
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' })).errors).toBeUndefined();
		const before = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		const model = app.get<Model<StoredBooking>>(getModelToken('Booking'));
		const original = model.findOneAndUpdate.bind(model) as typeof model.findOneAndUpdate;
		let changed = false;
		// Fault injection on a disposable booking, not a mocked API response or valid lifecycle transition.
		const spy = jest
			.spyOn(model, 'findOneAndUpdate')
			.mockImplementationOnce((...args: Parameters<typeof model.findOneAndUpdate>) => {
				const query = original(...args);
				const execute = query.exec.bind(query) as typeof query.exec;
				jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
					await connection
						.collection('bookings')
						.updateOne({ _id: new Types.ObjectId(booking._id) }, { $set: { paymentStatus: 'UNPAID' } });
					changed = true;
					return execute();
				});
				return query;
			});
		try {
			expect((await refund(booking._id)).errors).toBeDefined();
			expect(changed).toBe(true);
			expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual(before);
			expect((await storedBooking(booking._id))?.refundReference).toBeUndefined();
		} finally {
			spy.mockRestore();
		}
	});

	it('refunds a completed booking once while preserving trip, payment history, reviews and counters', async () => {
		const { tour, booking } = await completedFixture();
		const review = await graphql<{ createReview: { _id: string } }>(
			'mutation Review($input: ReviewInput!) { createReview(input: $input) { _id } }',
			{ input: { bookingId: booking._id, reviewRating: 4, reviewComment: 'Completed trip review' } },
			user.token,
		);
		expect(review.errors).toBeUndefined();
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' })).errors).toBeUndefined();
		const before = await connection.collection('bookings').findOne({ _id: new Types.ObjectId(booking._id) });
		const tourBefore = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		const reviewBefore = await connection.collection('reviews').findOne({ bookingId: new Types.ObjectId(booking._id) });
		const membersBefore = await connection.collection('members').find({}).sort({ _id: 1 }).toArray();
		for (const token of [user.token, agent.token, '']) {
			expect((await refund(booking._id, token)).errors).toBeDefined();
		}
		expect(await connection.collection('bookings').findOne({ _id: new Types.ObjectId(booking._id) })).toEqual(before);
		const results = await Promise.all([refund(booking._id), refund(booking._id)]);
		expect(results.filter((result) => result.data?.refundBookingByAdmin)).toHaveLength(1);
		const after = await connection.collection('bookings').findOne({ _id: new Types.ObjectId(booking._id) });
		expect(after).toMatchObject({
			bookingStatus: 'COMPLETED',
			paymentStatus: 'REFUNDED',
			refundReason: 'Cancelled departure refund',
		});
		expect(after?.refundReference).toEqual(expect.any(String));
		expect(after?.refundedAt).toBeInstanceOf(Date);
		// Compare every historical field, allowing only the financial correction and update timestamp.
		const financialFields = ['paymentStatus', 'refundReference', 'refundReason', 'refundedAt', 'updatedAt'];
		const history = (record: Record<string, unknown> | null) =>
			Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => !financialFields.includes(key)));
		expect(history(after)).toEqual(history(before));
		expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual({
			...tourBefore,
			__v: Number(tourBefore?.__v ?? 0) + 1,
		});
		expect(await connection.collection('reviews').findOne({ bookingId: new Types.ObjectId(booking._id) })).toEqual(
			reviewBefore,
		);
		expect(await connection.collection('members').find({}).sort({ _id: 1 }).toArray()).toEqual(membersBefore);
		expect((await refund(booking._id)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
		expect(await connection.collection('bookings').findOne({ _id: new Types.ObjectId(booking._id) })).toEqual(after);
		await expectSeats(tour, 1, 1, 'CANCELLED');
	});

	it('rejects new reviews after a completed-booking refund', async () => {
		const { tour, booking } = await completedFixture();
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' })).errors).toBeUndefined();
		expect((await refund(booking._id)).errors).toBeUndefined();
		const tourBefore = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		const memberBefore = await connection.collection('members').findOne({ _id: new Types.ObjectId(user.id) });
		const result = await graphql(
			'mutation Review($input: ReviewInput!) { createReview(input: $input) { _id } }',
			{ input: { bookingId: booking._id, reviewRating: 4, reviewComment: 'Refunded completed trip' } },
			user.token,
		);
		expect(result.errors?.[0].extensions?.code).toBe('NOT_FOUND');
		expect(await connection.collection('reviews').countDocuments({ bookingId: new Types.ObjectId(booking._id) })).toBe(
			0,
		);
		expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual(tourBefore);
		expect(await connection.collection('members').findOne({ _id: new Types.ObjectId(user.id) })).toEqual(memberBefore);
	});

	it('rejects completed-booking refunds on every other tour status or a missing tour without side effects', async () => {
		for (const status of ['DRAFT', 'PENDING', 'ACTIVE', 'SOLD_OUT', 'COMPLETED', 'MISSING']) {
			const { tour, booking } = await completedFixture();
			// Inject unsupported/missing tour states only in the disposable test database.
			if (status === 'MISSING') await connection.collection('tours').deleteOne({ _id: new Types.ObjectId(tour.id) });
			else
				await connection
					.collection('tours')
					.updateOne({ _id: new Types.ObjectId(tour.id) }, { $set: { tourStatus: status } });
			const before = await connection.collection('bookings').findOne({ _id: new Types.ObjectId(booking._id) });
			const tourBefore = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
			expect((await refund(booking._id)).errors?.[0].extensions?.code).toBe('CONFLICT');
			expect(await connection.collection('bookings').findOne({ _id: new Types.ObjectId(booking._id) })).toEqual(before);
			expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual(tourBefore);
		}
	});

	it('rolls back the completed-refund tour write when the final booking write loses eligibility', async () => {
		const { tour, booking } = await completedFixture();
		expect((await adminUpdate({ tourId: tour.id, tourStatus: 'CANCELLED' })).errors).toBeUndefined();
		const before = await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		const model = app.get<Model<StoredBooking>>(getModelToken('Booking'));
		const original = model.findOneAndUpdate.bind(model) as typeof model.findOneAndUpdate;
		let changed = false;
		// Real competing fixture write for fault injection; API responses are not mocked.
		const spy = jest
			.spyOn(model, 'findOneAndUpdate')
			.mockImplementationOnce((...args: Parameters<typeof model.findOneAndUpdate>) => {
				const query = original(...args);
				const execute = query.exec.bind(query) as typeof query.exec;
				jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
					await connection
						.collection('bookings')
						.updateOne({ _id: new Types.ObjectId(booking._id) }, { $set: { paymentStatus: 'UNPAID' } });
					changed = true;
					return execute();
				});
				return query;
			});
		try {
			expect((await refund(booking._id)).errors).toBeDefined();
			expect(changed).toBe(true);
			expect(await connection.collection('tours').findOne({ _id: new Types.ObjectId(tour.id) })).toEqual(before);
			expect((await storedBooking(booking._id))?.refundReference).toBeUndefined();
		} finally {
			spy.mockRestore();
		}
	});

	// Historical records are seeded only in the disposable database; these are live query tests,
	// not mocked responses or lifecycle-transition tests.
	describe('booking history visibility', () => {
		let historyUser: Actor;
		let historyAgent: Actor;
		const fixtures: Array<{ tour: Fixture; id: string; status: string; payment: string; tourStatus: string }> = [];
		type HistoryBooking = {
			_id: string;
			userId: string;
			agentId: string;
			bookingStatus: string;
			paymentStatus: string;
			unitPrice: number;
			totalPrice: number;
			selectedDate: string;
			selectedEndDate: string;
			paymentReference: string | null;
			refundReference: string | null;
			completedAt: string | null;
			tourData: { _id: string; tourTitle: string; tourStatus: string } | null;
			agentData: { _id: string; memberNick: string } | null;
			userData: { _id: string; memberNick: string } | null;
		};
		type HistoryPage = { list: HistoryBooking[]; metaCounter: Array<{ total: number }> };

		beforeAll(async () => {
			const suffix = new Types.ObjectId().toHexString().slice(-8);
			historyUser = await signup(`hist-user-${suffix}`, MemberType.USER);
			historyAgent = await signup(`hist-agent-${suffix}`, MemberType.AGENT);
			for (const [index, state] of [
				['COMPLETED', 'PAID', 'COMPLETED'],
				['COMPLETED', 'REFUNDED', 'CANCELLED'],
				['CANCELLED', 'UNPAID', 'CANCELLED'],
			].entries()) {
				const [status, payment, tourStatus] = state;
				const tour = await createTour(2, tourStatus);
				const date = new Date(Date.now() - (10 - index) * 86400000);
				await connection.collection('tours').updateOne(
					{ _id: new Types.ObjectId(tour.id) },
					{
						$set: {
							agentId: new Types.ObjectId(historyAgent.id),
							tourAvailableSeats: status === 'COMPLETED' ? 1 : 2,
							tourBookingCount: status === 'COMPLETED' ? 1 : 0,
							'tourAvailableDates.0.availableSeats': status === 'COMPLETED' ? 1 : 2,
							'tourAvailableDates.0.startDate': date,
							'tourAvailableDates.0.endDate': new Date(date.getTime() + 86400000),
						},
					},
				);
				const id = new Types.ObjectId();
				await app.get<Model<unknown>>(getModelToken('Booking')).create({
					_id: id,
					bookingCode: `HISTORY-${id.toHexString()}`,
					userId: new Types.ObjectId(historyUser.id),
					agentId: new Types.ObjectId(historyAgent.id),
					tourId: new Types.ObjectId(tour.id),
					tourDateId: new Types.ObjectId(tour.dateId),
					selectedDate: date,
					selectedEndDate: new Date(date.getTime() + 86400000),
					numberOfPeople: 1,
					unitPrice: 80,
					totalPrice: 80,
					bookingStatus: status,
					paymentStatus: payment,
					...(status === 'COMPLETED'
						? {
								completedAt: new Date(date.getTime() + 86400000),
								paidAt: date,
								paymentReference: `PAY-HISTORY-${index}`,
							}
						: {}),
					...(payment === 'REFUNDED'
						? {
								refundReference: 'REF-HISTORY',
								refundReason: 'Historical financial correction',
								refundedAt: new Date(),
							}
						: {}),
				});
				fixtures.push({ tour, id: id.toHexString(), status, payment, tourStatus });
			}
		});

		function history(action: string, token: string, input: Record<string, unknown> = {}) {
			const type =
				action === 'getMyBookings'
					? 'MyBookingsInquiry'
					: action === 'getAgentBookings'
						? 'AgentBookingsInquiry'
						: 'AllBookingsInquiry';
			return graphql<Record<string, HistoryPage>>(
				`query History($input: ${type}!) { ${action}(input: $input) { list {
					_id userId agentId bookingStatus paymentStatus unitPrice totalPrice selectedDate selectedEndDate
					paymentReference refundReference completedAt
					tourData { _id tourTitle tourStatus } agentData { _id memberNick } userData { _id memberNick }
				} metaCounter { total } } }`,
				{ input: { page: 1, limit: 100, sort: 'selectedDate', direction: 'ASC', search: {}, ...input } },
				token,
			);
		}

		it('shows cancelled, completed and refunded history with financial snapshots to each authorized role', async () => {
			for (const [action, token] of [
				['getMyBookings', historyUser.token],
				['getAgentBookings', historyAgent.token],
				['getAllBookingsByAdmin', adminToken],
			]) {
				const result = await history(
					action,
					token,
					action === 'getAllBookingsByAdmin' ? { search: { userId: historyUser.id } } : {},
				);
				expect(result.errors).toBeUndefined();
				const page = result.data![action];
				expect(page.metaCounter).toEqual([{ total: 3 }]);
				expect(page.list.map((booking) => booking._id)).toEqual(fixtures.map((fixture) => fixture.id));
				for (const [index, booking] of page.list.entries()) {
					const fixture = fixtures[index];
					expect(booking).toMatchObject({
						userId: historyUser.id,
						agentId: historyAgent.id,
						bookingStatus: fixture.status,
						paymentStatus: fixture.payment,
						unitPrice: 80,
						totalPrice: 80,
						tourData: { _id: fixture.tour.id, tourStatus: fixture.tourStatus, tourTitle: 'Booking test tour' },
					});
					const stored = await connection.collection('bookings').findOne({ _id: new Types.ObjectId(fixture.id) });
					expect(booking.selectedDate).toBe((stored?.selectedDate as Date).toISOString());
					expect(booking.selectedEndDate).toBe((stored?.selectedEndDate as Date).toISOString());
					if (fixture.status === 'COMPLETED') expect(booking.paymentReference).toBe(`PAY-HISTORY-${index}`);
					if (fixture.payment === 'REFUNDED') expect(booking.refundReference).toBe('REF-HISTORY');
					if (action !== 'getAgentBookings') expect(booking.agentData?._id).toBe(historyAgent.id);
					if (action !== 'getMyBookings') expect(booking.userData?._id).toBe(historyUser.id);
				}
			}
			for (const fixture of fixtures) {
				expect(
					(
						await graphql('query Tour($tourId: String!) { getTour(tourId: $tourId) { _id } }', {
							tourId: fixture.tour.id,
						})
					).errors?.[0].extensions?.code,
				).toBe('NOT_FOUND');
			}
		});

		it('enforces role boundaries and prevents another user or agent from seeing these bookings', async () => {
			for (const [action, tokens] of [
				['getMyBookings', [historyAgent.token, adminToken]],
				['getAgentBookings', [historyUser.token, adminToken]],
				['getAllBookingsByAdmin', [historyUser.token, historyAgent.token]],
			] as Array<[string, string[]]>) {
				for (const token of tokens)
					expect((await history(action, token)).errors?.[0].extensions?.code).toBe('FORBIDDEN');
				expect((await history(action, '')).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
			}
			const other = await history('getMyBookings', otherUser.token);
			expect(other.errors).toBeUndefined();
			expect(
				other.data!.getMyBookings.list.some((booking) => fixtures.some((fixture) => fixture.id === booking._id)),
			).toBe(false);
			const otherAgentResult = await history('getAgentBookings', otherAgent.token, {
				search: { tourId: fixtures[0].tour.id },
			});
			expect(otherAgentResult.data!.getAgentBookings).toEqual({ list: [], metaCounter: [] });
		});

		it('filters booking and payment states and paginates without changing total counts', async () => {
			for (const [action, token] of [
				['getMyBookings', historyUser.token],
				['getAgentBookings', historyAgent.token],
				['getAllBookingsByAdmin', adminToken],
			]) {
				const search = action === 'getAllBookingsByAdmin' ? { userId: historyUser.id, agentId: historyAgent.id } : {};
				const filtered = await history(action, token, {
					search: { ...search, bookingStatus: 'COMPLETED', paymentStatus: 'REFUNDED' },
				});
				expect(filtered.data![action].list.map((booking) => booking._id)).toEqual([fixtures[1].id]);
				expect(filtered.data![action].metaCounter).toEqual([{ total: 1 }]);
				for (const page of [1, 2, 3]) {
					const result = await history(action, token, { page, limit: 2, search });
					expect(result.data![action].list.map((booking) => booking._id)).toEqual(
						fixtures.slice((page - 1) * 2, page * 2).map((fixture) => fixture.id),
					);
					expect(result.data![action].metaCounter).toEqual([{ total: 3 }]);
				}
			}
			const agentFiltered = await history('getAgentBookings', historyAgent.token, {
				search: { tourId: fixtures[1].tour.id },
			});
			expect(agentFiltered.data!.getAgentBookings.list.map((booking) => booking._id)).toEqual([fixtures[1].id]);
			const adminFiltered = await history('getAllBookingsByAdmin', adminToken, {
				search: { tourId: fixtures[1].tour.id },
			});
			expect(adminFiltered.data!.getAllBookingsByAdmin.metaCounter).toEqual([{ total: 1 }]);
		});

		it('preserves bookings and counts when related tours or members are missing', async () => {
			const fixture = fixtures[0];
			const tour = await connection.collection('tours').findOne({ _id: new Types.ObjectId(fixture.tour.id) });
			const agentRecord = await connection.collection('members').findOne({ _id: new Types.ObjectId(historyAgent.id) });
			const userRecord = await connection.collection('members').findOne({ _id: new Types.ObjectId(historyUser.id) });
			try {
				await connection.collection('tours').deleteOne({ _id: tour!._id });
				await connection.collection('members').deleteOne({ _id: agentRecord!._id });
				for (const [action, token] of [
					['getMyBookings', historyUser.token],
					['getAllBookingsByAdmin', adminToken],
				]) {
					const result = await history(
						action,
						token,
						action === 'getAllBookingsByAdmin' ? { search: { userId: historyUser.id } } : {},
					);
					expect(result.errors).toBeUndefined();
					expect(result.data![action].metaCounter).toEqual([{ total: 3 }]);
					expect(result.data![action].list.find((booking) => booking._id === fixture.id)).toMatchObject({
						tourData: null,
						agentData: null,
						totalPrice: 80,
					});
				}
				await connection.collection('members').insertOne(agentRecord!);
				await connection.collection('members').deleteOne({ _id: userRecord!._id });
				const result = await history('getAgentBookings', historyAgent.token);
				expect(result.errors).toBeUndefined();
				expect(result.data!.getAgentBookings.metaCounter).toEqual([{ total: 3 }]);
				expect(result.data!.getAgentBookings.list.find((booking) => booking._id === fixture.id)).toMatchObject({
					tourData: null,
					userData: null,
					totalPrice: 80,
				});
			} finally {
				// Restore these exact disposable fixtures even on assertion failure; the suite later drops all counters.
				await connection.collection('tours').replaceOne({ _id: tour!._id }, tour!, { upsert: true });
				await connection.collection('members').replaceOne({ _id: agentRecord!._id }, agentRecord!, { upsert: true });
				await connection.collection('members').replaceOne({ _id: userRecord!._id }, userRecord!, { upsert: true });
			}
		});

		it('strips private member fields from history lookups before GraphQL serialization', async () => {
			const members = connection.collection('members');
			for (const actor of [historyUser, historyAgent]) {
				await members.updateOne(
					{ _id: new Types.ObjectId(actor.id) },
					{
						$set: {
							memberPhone: `PRIVATE-${actor.id}`,
							memberPhoneCountryCode: '+82',
							memberAddress: 'DISPOSABLE-PRIVATE-ADDRESS',
						},
					},
				);
			}
			const result = await app
				.get(BookingService)
				.getAllBookingsByAdmin({ page: 1, limit: 10, search: { userId: historyUser.id } });
			expect(result.list).toHaveLength(3);
			for (const booking of result.list) {
				for (const member of [booking.userData, booking.agentData]) {
					expect(member).toBeDefined();
					for (const field of [
						'memberPassword',
						'memberEmail',
						'memberPhone',
						'memberPhoneCountryCode',
						'memberAddress',
					])
						expect(member).not.toHaveProperty(field);
				}
			}
		});
	});

	async function completedFixture() {
		const fixture = await paidFixture();
		await expireDates(fixture.tour, fixture.booking._id);
		expect((await bookingAction('completeBooking', fixture.booking._id, agent.token)).errors).toBeUndefined();
		return fixture;
	}

	async function paidFixture(seats = 2) {
		const tour = await createTour(seats);
		const booking = await createBooking(tour, 1);
		expect((await bookingAction('confirmBooking', booking._id, agent.token)).errors).toBeUndefined();
		expect((await bookingAction('payBooking', booking._id, user.token)).errors).toBeUndefined();
		return { tour, booking };
	}

	function refund(bookingId: string, token = adminToken) {
		return inputAction(
			'refundBookingByAdmin',
			'BookingRefundInput',
			{ bookingId, refundReason: 'Cancelled departure refund' },
			token,
		);
	}

	function expire(bookingId: string, token = adminToken) {
		return bookingAction('expireBookingByAdmin', bookingId, token);
	}

	async function expireDates(tour: Fixture, bookingId: string) {
		// Advance only this disposable fixture; all its records and counters are dropped afterward.
		await endDepartures(tour);
		await connection
			.collection('bookings')
			.updateOne(
				{ _id: new Types.ObjectId(bookingId) },
				{ $set: { selectedDate: new Date(Date.now() - 172800000), selectedEndDate: new Date(Date.now() - 86400000) } },
			);
	}

	function adminUpdate(input: Record<string, unknown>, token = adminToken) {
		return graphql<{ updateTourByAdmin: { _id: string; tourStatus: string } }>(
			'mutation AdminUpdate($input: TourAdminUpdate!) { updateTourByAdmin(input: $input) { _id tourStatus } }',
			{ input },
			token,
		);
	}

	async function endDepartures(tour: Fixture) {
		// Only disposable records in tl_bk_e2e_* are adjusted and dropped with their counters afterward.
		await connection.collection('tours').updateOne(
			{ _id: new Types.ObjectId(tour.id) },
			{
				$set: {
					'tourAvailableDates.0.startDate': new Date(Date.now() - 172800000),
					'tourAvailableDates.0.endDate': new Date(Date.now() - 86400000),
				},
			},
		);
	}

	async function signup(nick: string, role: MemberType): Promise<Actor> {
		const result = await graphql<{ signup: { accessToken: string; member: { _id: string } } }>(
			'mutation Signup($input: MemberInput!) { signup(input: $input) { accessToken member { _id } } }',
			{
				input: {
					memberNick: nick,
					memberEmail: `${nick}@example.com`,
					memberPassword: 'TestPass123!',
					memberType: role,
				},
			},
		);
		if (!result.data?.signup) throw new Error(result.errors?.[0].message ?? 'Signup failed');
		return { id: result.data.signup.member._id, token: result.data.signup.accessToken };
	}

	async function createTour(seats: number, status = 'ACTIVE'): Promise<Fixture> {
		const _id = new Types.ObjectId();
		const dateId = new Types.ObjectId();
		const startDate = new Date(Date.now() + 604800000);
		const endDate = new Date(Date.now() + 691200000);
		await app.get<Model<unknown>>(getModelToken('Tour')).create({
			_id,
			agentId: new Types.ObjectId(agent.id),
			tourTitle: 'Booking test tour',
			tourSlug: `booking-${_id.toHexString()}`,
			tourDescription: 'A disposable booking test tour',
			tourDestination: 'Seoul',
			tourCountry: 'South Korea',
			tourCity: 'Seoul',
			tourImages: ['test.jpg'],
			tourPrice: 100,
			tourDiscountPrice: 80,
			tourDurationDays: 1,
			tourMaxGroupSize: 5,
			tourCategory: 'CITY',
			tourDifficulty: 'EASY',
			tourStatus: status,
			tourAvailableSeats: seats,
			tourAvailableDates: [{ _id: dateId, startDate, endDate, availableSeats: seats }],
			tourItinerary: [{ day: 1, title: 'Explore', description: 'Explore Seoul' }],
		});
		return { id: _id.toHexString(), dateId: dateId.toHexString(), startDate, endDate };
	}

	async function createBooking(tour: Fixture, people: number): Promise<BookingResult> {
		const result = await inputAction(
			'createBooking',
			'BookingInput',
			{
				tourId: tour.id,
				tourDateId: tour.dateId,
				numberOfPeople: people,
			},
			user.token,
		);
		expect(result.errors).toBeUndefined();
		return result.data!.createBooking;
	}

	function bookingAction(action: string, bookingId: string, token: string) {
		return graphql<Record<string, BookingResult>>(
			`mutation Action($bookingId: String!) { ${action}(bookingId: $bookingId) { _id bookingStatus paymentStatus totalPrice } }`,
			{ bookingId },
			token,
		);
	}

	function inputAction(action: string, type: string, input: Record<string, unknown>, token: string) {
		return graphql<Record<string, BookingResult>>(
			`mutation Action($input: ${type}!) { ${action}(input: $input) { _id bookingStatus paymentStatus totalPrice } }`,
			{ input },
			token,
		);
	}

	function cancel(bookingId: string, token: string) {
		return inputAction(
			'cancelBooking',
			'BookingCancellationInput',
			{ bookingId, cancellationReason: 'Test cancellation' },
			token,
		);
	}

	function updateTour(input: Record<string, unknown>, token = agent.token) {
		return graphql<{ updateTour: { _id: string } }>(
			'mutation Update($input: TourUpdate!) { updateTour(input: $input) { _id } }',
			{ input },
			token,
		);
	}

	function storedBooking(bookingId: string) {
		return connection.collection<StoredBooking>('bookings').findOne({ _id: new Types.ObjectId(bookingId) });
	}

	async function expectSeats(tour: Fixture, seats: number, bookings: number, status: string) {
		const stored = await connection.collection<StoredTour>('tours').findOne({ _id: new Types.ObjectId(tour.id) });
		expect(stored).toMatchObject({ tourAvailableSeats: seats, tourBookingCount: bookings, tourStatus: status });
		expect(stored?.tourAvailableDates[0].availableSeats).toBe(seats);
	}

	async function graphql<T>(query: string, variables: Record<string, unknown>, token?: string): Promise<Response<T>> {
		const pending = request(app.getHttpServer()).post('/graphql');
		if (token) pending.set('Authorization', `Bearer ${token}`);
		const response = await pending.send({ query, variables }).expect(200);
		return JSON.parse(response.text) as Response<T>;
	}
});
