import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/components/auth/auth.service';
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
		adminToken = await app.get(AuthService).createToken({
			_id: new Types.ObjectId().toHexString(),
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
