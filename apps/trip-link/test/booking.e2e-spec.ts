import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
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
	tourAvailableDates: Array<{ _id: Types.ObjectId; availableSeats: number }>;
};
type StoredBooking = { _id: Types.ObjectId; tourId: Types.ObjectId; bookingStatus: string };

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

	function updateTour(input: Record<string, unknown>) {
		return graphql<{ updateTour: { _id: string } }>(
			'mutation Update($input: TourUpdate!) { updateTour(input: $input) { _id } }',
			{ input },
			agent.token,
		);
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
