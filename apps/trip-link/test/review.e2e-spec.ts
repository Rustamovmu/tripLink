import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { MemberType } from '../src/libs/enums/member.enum';

jest.setTimeout(30000);

type Actor = { id: Types.ObjectId; token: string };
type ReviewResult = { _id: string; reviewStatus: string; reviewRating: number };
type Response<T> = { data?: T | null; errors?: Array<{ extensions?: { code?: string } }> };

describe('Review eligibility, ratings and moderation (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let originalMongo: string | undefined;
	let database: string;
	let user: Actor;
	let otherUser: Actor;
	let agent: Actor;
	let admin: Actor;

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Review tests cannot run in production');
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = `tl_review_e2e_${new Types.ObjectId().toHexString()}`;
		const url = new URL(originalMongo);
		url.pathname = `/${database}`;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.init();
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== database) throw new Error('Unexpected review test database');
		await app.get<Model<unknown>>(getModelToken('Review')).init();
		user = await actor(MemberType.USER);
		otherUser = await actor(MemberType.USER);
		agent = await actor(MemberType.AGENT);
		admin = await actor(MemberType.ADMIN);
	});

	afterAll(async () => {
		try {
			if (connection && connection.name === database && /^tl_review_e2e_[a-f0-9]{24}$/.test(database)) {
				await connection.dropDatabase();
			}
		} finally {
			if (app) await app.close();
			if (originalMongo === undefined) delete process.env.MONGO_DEV;
			else process.env.MONGO_DEV = originalMongo;
		}
	});

	it('allows only an owned completed paid booking and leaves rejected records and counters unchanged', async () => {
		const tour = await fixtureTour();
		for (const status of ['PENDING', 'CONFIRMED', 'CANCELLED', 'REJECTED', 'COMPLETED']) {
			for (const payment of ['UNPAID', 'PAID', 'REFUNDED']) {
				if (status === 'COMPLETED' && payment === 'PAID') continue;
				const booking = await fixtureBooking(tour, status, payment);
				const before = await snapshot(tour);
				expect((await create(booking)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
				expect(await snapshot(tour)).toEqual(before);
			}
		}
		const booking = await fixtureBooking(tour);
		for (const token of [otherUser.token, agent.token, admin.token, '']) {
			const before = await snapshot(tour);
			expect((await create(booking, 4, token)).errors).toBeDefined();
			expect(await snapshot(tour)).toEqual(before);
		}
		expect((await create(booking)).data?.createReview.reviewRating).toBe(4);
	});

	it('rejects invalid ratings and whitespace comments without side effects', async () => {
		const tour = await fixtureTour();
		const booking = await fixtureBooking(tour);
		const before = await snapshot(tour);
		for (const input of [
			{ bookingId: booking, reviewRating: 0, reviewComment: 'Valid comment' },
			{ bookingId: booking, reviewRating: 6, reviewComment: 'Valid comment' },
			{ bookingId: booking, reviewRating: 4, reviewComment: '   ' },
		]) {
			expect((await mutation('createReview', 'ReviewInput', input, user.token)).errors).toBeDefined();
		}
		expect(await snapshot(tour)).toEqual(before);
	});

	it('calculates creation ratings from actual active reviews without accumulated rounding', async () => {
		const tour = await fixtureTour();
		for (const rating of [1, 1, 1, 1, 1, 1, 1, 2, 1]) {
			expect((await create(await fixtureBooking(tour), rating)).errors).toBeUndefined();
		}
		expect(await connection.collection('tours').findOne({ _id: tour })).toMatchObject({
			tourReviewCount: 9,
			tourAverageRating: 1.11,
		});
	});

	it('creates concurrent distinct reviews and rejects duplicate bookings with exact counters', async () => {
		const tour = await fixtureTour();
		const first = await fixtureBooking(tour);
		const second = await fixtureBooking(tour);
		const before = await connection.collection('members').findOne({ _id: user.id });
		const results = await Promise.all([create(first, 1), create(first, 1), create(second, 5)]);
		expect(results.filter((result) => result.data?.createReview)).toHaveLength(2);
		expect(results.filter((result) => result.errors)).toHaveLength(1);
		expect(await connection.collection('tours').findOne({ _id: tour })).toMatchObject({
			tourReviewCount: 2,
			tourAverageRating: 3,
		});
		const after = await connection.collection('members').findOne({ _id: user.id });
		expect(after?.memberReviews).toBe(Number(before?.memberReviews) + 2);
	});

	it('enforces ownership and active status for editing and deletion; deletion prevents recreation', async () => {
		const tour = await fixtureTour();
		const booking = await fixtureBooking(tour);
		const review = (await create(booking)).data!.createReview;
		const before = await snapshot(tour);
		expect((await update(review._id, 5, otherUser.token)).errors).toBeDefined();
		expect((await remove(review._id, otherUser.token)).errors).toBeDefined();
		expect(await snapshot(tour)).toEqual(before);
		expect((await update(review._id, 5)).errors).toBeUndefined();
		expect((await remove(review._id)).data?.removeReview.reviewStatus).toBe('DELETE');
		const deleted = await snapshot(tour);
		expect((await update(review._id, 1)).errors).toBeDefined();
		expect((await remove(review._id)).errors).toBeDefined();
		expect((await moderate(review._id, 'ACTIVE')).errors).toBeDefined();
		expect((await create(booking)).errors?.[0].extensions?.code).toBe('CONFLICT');
		expect(await snapshot(tour)).toEqual(deleted);
	});

	it('keeps moderation available after author promotion and suspension with correct counters', async () => {
		for (const role of [MemberType.AGENT, MemberType.ADMIN]) {
			const author = await actor(MemberType.USER);
			const tour = await fixtureTour();
			const review = (await create(await fixtureBooking(tour, 'COMPLETED', 'PAID', author), 4, author.token)).data!
				.createReview;
			await connection
				.collection('members')
				.updateOne({ _id: author.id }, { $set: { memberType: role, memberStatus: 'SUSPENDED' } });
			for (const [status, count] of [
				['HIDDEN', 0],
				['ACTIVE', 1],
			] as const) {
				expect((await moderate(review._id, status)).errors).toBeUndefined();
				expect(await connection.collection('members').findOne({ _id: author.id })).toMatchObject({
					memberReviews: count,
				});
				expect(await connection.collection('tours').findOne({ _id: tour })).toMatchObject({
					tourReviewCount: count,
					tourAverageRating: count ? 4 : 0,
				});
			}
		}
	});

	it('moderates only for admins, rejects repeated transitions, and hides content from public lists', async () => {
		const tour = await fixtureTour();
		const review = (await create(await fixtureBooking(tour))).data!.createReview;
		for (const token of [user.token, agent.token, '']) {
			expect((await moderate(review._id, 'HIDDEN', token)).errors).toBeDefined();
		}
		const results = await Promise.all([moderate(review._id, 'HIDDEN'), moderate(review._id, 'HIDDEN')]);
		expect(results.filter((result) => result.data?.moderateReviewByAdmin)).toHaveLength(1);
		const hidden = await snapshot(tour);
		expect((await moderate(review._id, 'HIDDEN')).errors).toBeDefined();
		expect((await update(review._id, 2)).errors).toBeDefined();
		expect((await remove(review._id)).errors).toBeDefined();
		expect(await snapshot(tour)).toEqual(hidden);
		expect((await publicReviews(tour)).data?.getTourReviews.list).toEqual([]);
		expect((await moderate(review._id, 'ACTIVE')).errors).toBeUndefined();
		expect((await publicReviews(tour)).data?.getTourReviews.list).toHaveLength(1);
		await connection.collection('tours').updateOne({ _id: tour }, { $set: { tourStatus: 'CANCELLED' } });
		expect((await publicReviews(tour)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
	});

	it('retains existing reviews after a live simulated refund but rejects new ones', async () => {
		const tour = await fixtureTour();
		const booking = await fixtureBooking(tour);
		const newBooking = await fixtureBooking(tour);
		const review = (await create(booking)).data!.createReview;
		await connection.collection('tours').updateOne({ _id: tour }, { $set: { tourStatus: 'CANCELLED' } });
		for (const bookingId of [booking, newBooking]) {
			const result = await graphql<Record<string, unknown>>(
				'mutation Refund($input: BookingRefundInput!) { refundBookingByAdmin(input: $input) { _id paymentStatus } }',
				{ input: { bookingId, refundReason: 'Disposable review test refund' } },
				admin.token,
			);
			expect(result.errors).toBeUndefined();
		}
		expect((await update(review._id, 5)).errors).toBeUndefined();
		expect((await create(newBooking)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
		expect((await moderate(review._id, 'HIDDEN')).errors).toBeUndefined();
		expect((await moderate(review._id, 'ACTIVE')).errors).toBeUndefined();
	});

	it('rolls back review and tour changes if the moderation counter cannot be decremented', async () => {
		const author = await actor(MemberType.USER);
		const tour = await fixtureTour();
		const review = (await create(await fixtureBooking(tour, 'COMPLETED', 'PAID', author), 4, author.token)).data!
			.createReview;
		// Deliberate counter corruption exists only in this disposable database.
		await connection.collection('members').updateOne({ _id: author.id }, { $set: { memberReviews: 0 } });
		const before = await snapshot(tour);
		expect((await moderate(review._id, 'HIDDEN')).errors?.[0].extensions?.code).toBe('CONFLICT');
		expect(await snapshot(tour)).toEqual(before);
		expect(await connection.collection('members').findOne({ _id: author.id })).toMatchObject({ memberReviews: 0 });
	});

	async function actor(role: MemberType): Promise<Actor> {
		const id = new Types.ObjectId();
		const nick = `rv-${id.toHexString().slice(-8)}`;
		await connection
			.collection('members')
			.insertOne({ _id: id, memberType: role, memberStatus: 'ACTIVE', memberNick: nick, memberReviews: 0 });
		const token = await app.get(AuthService).createToken({ _id: id, memberType: role, memberNick: nick });
		return { id, token };
	}

	async function fixtureTour(): Promise<Types.ObjectId> {
		const id = new Types.ObjectId();
		// Historical test fixtures are real MongoDB records, not mocked API responses.
		const tours = connection.collection('tours');
		await tours.insertOne({
			_id: id,
			agentId: agent.id,
			tourTitle: 'Disposable review tour',
			tourSlug: `review-${id.toHexString()}`,
			tourStatus: 'ACTIVE',
			tourReviewCount: 0,
			tourAverageRating: 0,
		});
		return id;
	}

	async function fixtureBooking(
		tourId: Types.ObjectId,
		bookingStatus = 'COMPLETED',
		paymentStatus = 'PAID',
		author = user,
	): Promise<string> {
		const id = new Types.ObjectId();
		const bookings = connection.collection('bookings');
		await bookings.insertOne({
			_id: id,
			bookingCode: `RV-${id.toHexString()}`,
			userId: author.id,
			agentId: agent.id,
			tourId,
			bookingStatus,
			paymentStatus,
		});
		return id.toHexString();
	}

	async function snapshot(tour: Types.ObjectId) {
		return {
			tour: await connection.collection('tours').findOne({ _id: tour }),
			reviews: await connection.collection('reviews').find({ tourId: tour }).sort({ _id: 1 }).toArray(),
			user: await connection.collection('members').findOne({ _id: user.id }),
			bookings: await connection.collection('bookings').find({ tourId: tour }).sort({ _id: 1 }).toArray(),
		};
	}

	function create(bookingId: string, rating = 4, token: string | undefined = user.token) {
		return mutation(
			'createReview',
			'ReviewInput',
			{ bookingId, reviewRating: rating, reviewComment: 'Disposable review comment' },
			token,
		);
	}
	function update(reviewId: string, reviewRating: number, token = user.token) {
		return mutation('updateReview', 'ReviewUpdate', { reviewId, reviewRating }, token);
	}
	function moderate(reviewId: string, reviewStatus: string, token: string | undefined = admin.token) {
		return mutation(
			'moderateReviewByAdmin',
			'ReviewModerationInput',
			{ reviewId, reviewStatus, moderationReason: 'Disposable moderation test' },
			token,
		);
	}
	function remove(reviewId: string, token = user.token) {
		return graphql<Record<string, ReviewResult>>(
			'mutation Remove($reviewId: String!) { removeReview(reviewId: $reviewId) { _id reviewStatus reviewRating } }',
			{ reviewId },
			token,
		);
	}
	function mutation(action: string, type: string, input: Record<string, unknown>, token?: string) {
		return graphql<Record<string, ReviewResult>>(
			`mutation Action($input: ${type}!) { ${action}(input: $input) { _id reviewStatus reviewRating } }`,
			{ input },
			token,
		);
	}
	function publicReviews(tour: Types.ObjectId) {
		return graphql<{ getTourReviews: { list: ReviewResult[] } }>(
			'query Reviews($input: TourReviewsInquiry!) { getTourReviews(input: $input) { list { _id reviewStatus reviewRating } } }',
			{ input: { page: 1, limit: 100, search: { tourId: tour.toHexString() } } },
		);
	}
	async function graphql<T>(query: string, variables: Record<string, unknown>, token?: string): Promise<Response<T>> {
		const operation = request(app.getHttpServer()).post('/graphql');
		if (token) operation.set('Authorization', `Bearer ${token}`);
		const response = await operation.send({ query, variables });
		return response.body as Response<T>;
	}
});
