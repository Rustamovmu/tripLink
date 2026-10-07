import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { FavoriteService } from '../src/components/favorite/favorite.service';
import { ViewService } from '../src/components/view/view.service';
import { MemberType } from '../src/libs/enums/member.enum';
import { TourStatus } from '../src/libs/enums/tour.enum';

type Actor = { id: Types.ObjectId; token: string };
type TourRow = {
	_id: string;
	tourStatus: string;
	tourFavoriteCount: number;
	tourViewCount: number;
	agentData?: { memberNick: string } | null;
};
type Data = {
	getTour?: TourRow;
	toggleFavoriteTour?: { favorited: boolean; tour: TourRow };
	getFavoriteTours?: { list: TourRow[]; metaCounter: Array<{ total: number }> };
	getVisitedTours?: { list: TourRow[]; metaCounter: Array<{ total: number }> };
};
type Response = { data?: Data | null; errors?: Array<{ extensions?: { code?: string } }> };
const fields = '_id tourStatus tourFavoriteCount tourViewCount agentData { memberNick }';
jest.setTimeout(45000);

describe('Tour favorites and visited history (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let originalMongo: string | undefined;
	let database: string;
	let user: Actor;
	let otherUser: Actor;
	let agent: Actor;
	let admin: Actor;

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Interaction tests cannot run in production');
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = `tl_int_e2e_${new Types.ObjectId().toHexString()}`;
		const url = new URL(originalMongo);
		url.pathname = `/${database}`;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.init();
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== database) throw new Error('Unexpected interaction database');
		for (const name of ['Tour', 'Favorite', 'View']) await app.get<Model<unknown>>(getModelToken(name)).init();
		user = await actor(MemberType.USER);
		otherUser = await actor(MemberType.USER);
		agent = await actor(MemberType.AGENT);
		admin = await actor(MemberType.ADMIN);
	});
	afterAll(async () => {
		try {
			if (connection && connection.name === database && /^tl_int_e2e_[a-f0-9]{24}$/.test(database))
				await connection.dropDatabase();
		} finally {
			if (app) await app.close();
			if (originalMongo === undefined) delete process.env.MONGO_DEV;
			else process.env.MONGO_DEV = originalMongo;
		}
	});

	it('allows users and agents, including an agent saving their own tour, with exact shared favorite counts', async () => {
		const id = await tour();
		const members = await connection.collection('members').find().sort({ _id: 1 }).toArray();
		for (const member of [user, agent]) {
			const response = await toggle(id, member.token);
			expect(response.errors).toBeUndefined();
			expect(response.data?.toggleFavoriteTour?.favorited).toBe(true);
			const listed = await list('getFavoriteTours', member.token);
			expect(listed.data?.getFavoriteTours?.list.some((row) => row._id === id.toHexString())).toBe(true);
		}
		expect(await connection.collection('tours').findOne({ _id: id })).toMatchObject({ tourFavoriteCount: 2 });
		expect((await toggle(id, agent.token)).data?.toggleFavoriteTour).toMatchObject({
			favorited: false,
			tour: { tourFavoriteCount: 1 },
		});
		expect(await connection.collection('members').find().sort({ _id: 1 }).toArray()).toEqual(members);
	});

	it('counts user and agent visits once, refreshes visit recency, and leaves anonymous/admin reads uncounted', async () => {
		const id = await tour();
		for (const token of ['', admin.token]) expect((await detail(id, token)).data?.getTour?.tourViewCount).toBe(0);
		for (const member of [user, agent]) {
			expect((await detail(id, member.token)).errors).toBeUndefined();
			const oldDate = new Date('2000-01-01');
			await connection
				.collection('views')
				.updateOne({ memberId: member.id, viewRefId: id, viewGroup: 'TOUR' }, { $set: { updatedAt: oldDate } });
			expect((await detail(id, member.token)).errors).toBeUndefined();
			const view = await connection
				.collection('views')
				.findOne({ memberId: member.id, viewRefId: id, viewGroup: 'TOUR' });
			expect(view?.updatedAt).not.toEqual(oldDate);
			expect(
				(await list('getVisitedTours', member.token)).data?.getVisitedTours?.list.some(
					(row) => row._id === id.toHexString(),
				),
			).toBe(true);
		}
		expect(await connection.collection('views').countDocuments({ viewRefId: id, viewGroup: 'TOUR' })).toBe(2);
		expect((await detail(id, user.token)).data?.getTour?.tourViewCount).toBe(2);
	});

	it('denies admin/anonymous protected lists and toggles, and validates disabled or outdated-role tokens', async () => {
		const id = await tour();
		for (const token of ['', admin.token]) {
			const before = await snapshot();
			for (const response of [
				await toggle(id, token),
				await list('getFavoriteTours', token),
				await list('getVisitedTours', token),
			])
				expect(response.errors).toBeDefined();
			expect(await snapshot()).toEqual(before);
		}
		for (const role of [MemberType.USER, MemberType.AGENT]) {
			const member = await actor(role);
			for (const status of ['BLOCK', 'SUSPENDED', 'PENDING', 'DELETE']) {
				await connection.collection('members').updateOne({ _id: member.id }, { $set: { memberStatus: status } });
				const before = await snapshot();
				for (const response of [
					await toggle(id, member.token),
					await list('getFavoriteTours', member.token),
					await list('getVisitedTours', member.token),
					await detail(id, member.token),
				])
					expect(response.errors).toBeDefined();
				expect(await snapshot()).toEqual(before);
			}
			await connection
				.collection('members')
				.updateOne({ _id: member.id }, { $set: { memberStatus: 'ACTIVE', memberType: 'ADMIN' } });
			const before = await snapshot();
			expect((await toggle(id, member.token)).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
			expect(await snapshot()).toEqual(before);
		}
	});

	it('rejects every nonpublic status, invalid IDs and invalid pagination without side effects', async () => {
		for (const status of [TourStatus.DRAFT, TourStatus.PENDING, TourStatus.CANCELLED, TourStatus.COMPLETED]) {
			const id = await tour(status);
			const before = await snapshot();
			for (const member of [user, agent]) {
				expect((await toggle(id, member.token)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
				expect((await detail(id, member.token)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
			}
			expect(await snapshot()).toEqual(before);
		}
		const before = await snapshot();
		for (const id of ['invalid', new Types.ObjectId().toHexString()])
			expect((await toggle(id, user.token)).errors).toBeDefined();
		for (const action of ['getFavoriteTours', 'getVisitedTours'] as const) {
			for (const input of [
				{ page: 0, limit: 10 },
				{ page: 1, limit: 101 },
				{ page: 1.5, limit: 10 },
			])
				expect((await list(action, agent.token, input)).errors).toBeDefined();
		}
		expect(await snapshot()).toEqual(before);
	});

	it('serializes concurrent first views and favorite toggles without duplicates or counter drift', async () => {
		const id = await tour();
		const favorites = await Promise.all([toggle(id), toggle(id), toggle(id, agent.token), toggle(id, otherUser.token)]);
		for (const response of favorites) expect(response.errors).toBeUndefined();
		expect(await connection.collection('favorites').countDocuments({ tourId: id })).toBe(2);
		expect(await connection.collection('favorites').countDocuments({ tourId: id, memberId: user.id })).toBe(0);
		expect(await connection.collection('tours').findOne({ _id: id })).toMatchObject({ tourFavoriteCount: 2 });
		const views = await Promise.all([
			detail(id, user.token),
			detail(id, user.token),
			detail(id, agent.token),
			detail(id, otherUser.token),
		]);
		for (const response of views) expect(response.errors).toBeUndefined();
		expect(await connection.collection('views').countDocuments({ viewRefId: id, viewGroup: 'TOUR' })).toBe(3);
		expect((await detail(id, agent.token)).data?.getTour?.tourViewCount).toBe(3);
	});

	it('recounts existing views and favorites from actual records rather than preserving corrupted counts', async () => {
		const id = await tour();
		await detail(id, user.token);
		await toggle(id);
		await connection.collection('tours').updateOne({ _id: id }, { $set: { tourViewCount: 99, tourFavoriteCount: 99 } });
		expect((await detail(id, user.token)).data?.getTour?.tourViewCount).toBe(1);
		expect((await toggle(id)).data?.toggleFavoriteTour?.tour.tourFavoriteCount).toBe(0);
	});

	it('filters hidden and missing tours before pagination, isolates members, and uses stable timestamp tie-breakers', async () => {
		const member = await actor(MemberType.AGENT);
		const ids = [
			await tour(),
			await tour(TourStatus.SOLD_OUT),
			await tour(TourStatus.PENDING),
			await tour(TourStatus.CANCELLED),
			new Types.ObjectId(),
		];
		const date = new Date('2000-01-01');
		const viewRecords = connection.collection('views');
		for (const id of ids) {
			await connection
				.collection('favorites')
				.insertOne({ _id: new Types.ObjectId(), memberId: member.id, tourId: id, createdAt: date, updatedAt: date });
			await viewRecords.insertOne({
				_id: new Types.ObjectId(),
				memberId: member.id,
				viewRefId: id,
				viewGroup: 'TOUR',
				createdAt: date,
				updatedAt: date,
			});
		}
		// An ARTICLE view must not appear in tour history even if it happens to reference a tour ID.
		await viewRecords.insertOne({
			memberId: member.id,
			viewRefId: ids[0],
			viewGroup: 'ARTICLE',
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		for (const action of ['getFavoriteTours', 'getVisitedTours'] as const) {
			const first = (await list(action, member.token, { page: 1, limit: 1 })).data?.[action];
			const second = (await list(action, member.token, { page: 2, limit: 1 })).data?.[action];
			expect(first?.metaCounter).toEqual([{ total: 2 }]);
			expect(first?.list.map((row) => row._id)).toEqual([ids[1].toHexString()]);
			expect(second?.list.map((row) => row._id)).toEqual([ids[0].toHexString()]);
			expect((await list(action, member.token, { page: 1, limit: 1 })).data?.[action]?.list).toEqual(first?.list);
			expect(
				(await list(action, otherUser.token)).data?.[action]?.list.some((row) =>
					ids.some((id) => id.toHexString() === row._id),
				),
			).toBe(false);
		}
	});

	it('omits author credentials and contact fields, preserving list totals when the author is missing', async () => {
		const author = await actor(MemberType.AGENT);
		const member = await actor(MemberType.USER);
		const id = await tour(TourStatus.ACTIVE, author.id);
		await detail(id, member.token);
		await toggle(id, member.token);
		const favorites = app.get<FavoriteService>(FavoriteService);
		const views = app.get<ViewService>(ViewService);
		for (const result of [
			await favorites.getFavoriteTours(member.id.toHexString(), { page: 1, limit: 10 }),
			await views.getVisitedTours(member.id.toHexString(), { page: 1, limit: 10 }),
		]) {
			for (const field of ['memberPassword', 'memberEmail', 'memberPhone', 'memberPhoneCountryCode', 'memberAddress'])
				expect(result.list[0].agentData).not.toHaveProperty(field);
		}
		await connection.collection('members').deleteOne({ _id: author.id });
		for (const action of ['getFavoriteTours', 'getVisitedTours'] as const) {
			const result = (await list(action, member.token)).data?.[action];
			expect(result?.metaCounter).toEqual([{ total: 1 }]);
			expect(result?.list[0].agentData).toBeNull();
		}
	});

	it.each(['favorite', 'view'])(
		'retries transient duplicate-key %s errors and stops after four attempts (injected failure)',
		async (interaction) => {
			const id = await tour();
			const favoriteService = app.get<FavoriteService>(FavoriteService);
			const viewService = app.get<ViewService>(ViewService);
			const duplicate = Object.assign(new Error('Injected duplicate-key race'), { code: 11000 });
			const spy =
				interaction === 'favorite'
					? jest.spyOn(favoriteService, 'toggleFavorite').mockRejectedValueOnce(duplicate)
					: jest.spyOn(viewService, 'recordView').mockRejectedValueOnce(duplicate);
			try {
				expect((await (interaction === 'favorite' ? toggle(id) : detail(id, user.token))).errors).toBeUndefined();
				expect(spy).toHaveBeenCalledTimes(2);
				spy.mockClear();
				spy.mockRejectedValue(duplicate);
				const before = await snapshot();
				expect(
					(await (interaction === 'favorite' ? toggle(id) : detail(id, user.token))).errors?.[0].extensions?.code,
				).toBe('CONFLICT');
				expect(spy).toHaveBeenCalledTimes(4);
				expect(await snapshot()).toEqual(before);
			} finally {
				spy.mockRestore();
			}
		},
	);

	it.each(['favorite', 'view', 'repeat-view'])(
		'rolls back a %s interaction racing with cancellation, including visit timestamps',
		async (interaction) => {
			const id = await tour();
			if (interaction === 'repeat-view') await detail(id, user.token);
			const before = await snapshot();
			let reached!: () => void;
			let release!: () => void;
			const ready = new Promise<void>((resolve) => {
				reached = resolve;
			});
			const proceed = new Promise<void>((resolve) => {
				release = resolve;
			});
			const favorites = app.get<FavoriteService>(FavoriteService);
			const views = app.get<ViewService>(ViewService);
			const countFavorites = favorites.countTourFavorites.bind(favorites) as FavoriteService['countTourFavorites'];
			const countViews = views.countTargetViews.bind(views) as ViewService['countTargetViews'];
			const spy =
				interaction === 'favorite'
					? jest.spyOn(favorites, 'countTourFavorites').mockImplementationOnce(async (...args) => {
							const count = await countFavorites(...args);
							reached();
							await proceed;
							return count;
						})
					: jest.spyOn(views, 'countTargetViews').mockImplementationOnce(async (...args) => {
							const count = await countViews(...args);
							reached();
							await proceed;
							return count;
						});
			const pending = interaction === 'favorite' ? toggle(id) : detail(id, user.token);
			try {
				await barrier(ready);
				await connection.collection('tours').updateOne({ _id: id }, { $set: { tourStatus: 'CANCELLED' } });
				release();
				expect((await pending).errors).toBeDefined();
			} finally {
				release();
				await pending;
				spy.mockRestore();
			}
			const after = await snapshot();
			expect(after[0]).toEqual(before[0]);
			expect(after[1]).toEqual(before[1]);
			expect(after[3]).toEqual(before[3]);
			expect(await connection.collection('tours').findOne({ _id: id })).toMatchObject({
				tourStatus: 'CANCELLED',
				tourFavoriteCount: 0,
				tourViewCount: interaction === 'repeat-view' ? 1 : 0,
			});
		},
	);

	it.each(['favorite', 'view'])(
		'rolls back %s changes when its counter lookup fails (injected database failure)',
		async (interaction) => {
			const id = await tour();
			if (interaction === 'favorite') await toggle(id);
			const before = await snapshot();
			const failure = new Error('Injected private database failure');
			const spy =
				interaction === 'favorite'
					? jest.spyOn(app.get<FavoriteService>(FavoriteService), 'countTourFavorites').mockRejectedValueOnce(failure)
					: jest.spyOn(app.get<ViewService>(ViewService), 'countTargetViews').mockRejectedValueOnce(failure);
			try {
				const response = await (interaction === 'favorite' ? toggle(id) : detail(id, user.token));
				expect(response.errors?.[0].extensions?.code).toBe('INTERNAL_SERVER_ERROR');
				expect(await snapshot()).toEqual(before);
			} finally {
				spy.mockRestore();
			}
		},
	);

	async function actor(role: MemberType): Promise<Actor> {
		const id = new Types.ObjectId();
		const nick = `int-${id.toHexString()}`;
		const members = app.get<Model<unknown>>(getModelToken('Member'));
		await members.create({
			_id: id,
			memberNick: nick,
			memberType: role,
			memberStatus: 'ACTIVE',
			memberPassword: 'disposable-test-hash',
			memberEmail: `${nick}@example.invalid`,
			memberPhone: id.toHexString(),
			memberAddress: 'Private fixture address',
		});
		return {
			id,
			token: await app.get<AuthService>(AuthService).createToken({ _id: id, memberNick: nick, memberType: role }),
		};
	}
	async function tour(status = TourStatus.ACTIVE, owner = agent.id): Promise<Types.ObjectId> {
		const id = new Types.ObjectId();
		const tours = app.get<Model<unknown>>(getModelToken('Tour'));
		await tours.create({
			_id: id,
			tourTitle: 'Disposable interaction tour',
			tourSlug: `interaction-${id.toHexString()}`,
			tourDescription: 'Disposable test description',
			tourDestination: 'Test destination',
			tourCountry: 'Test country',
			tourCity: 'Test city',
			tourPrice: 100,
			tourDurationDays: 1,
			tourAvailableSeats: 10,
			tourMaxGroupSize: 10,
			tourCategory: 'CITY',
			tourDifficulty: 'EASY',
			tourStatus: status,
			agentId: owner,
		});
		return id;
	}
	function send(query: string, variables: Record<string, unknown>, token: string): Promise<Response> {
		const req = request(app.getHttpServer()).post('/graphql');
		if (token) req.set('Authorization', `Bearer ${token}`);
		return req.send({ query, variables }).then((res) => res.body as Response);
	}
	function toggle(id: Types.ObjectId | string, token = user.token) {
		return send(
			`mutation($tourId: String!) { toggleFavoriteTour(tourId: $tourId) { favorited tour { ${fields} } } }`,
			{ tourId: id.toString() },
			token,
		);
	}
	function detail(id: Types.ObjectId | string, token = '') {
		return send(`query($tourId: String!) { getTour(tourId: $tourId) { ${fields} } }`, { tourId: id.toString() }, token);
	}
	function list(action: 'getFavoriteTours' | 'getVisitedTours', token: string, input = { page: 1, limit: 100 }) {
		const type = action === 'getFavoriteTours' ? 'FavoriteToursInquiry' : 'VisitedToursInquiry';
		return send(
			`query($input: ${type}!) { ${action}(input: $input) { list { ${fields} } metaCounter { total } } }`,
			{ input },
			token,
		);
	}
	function snapshot() {
		return Promise.all(
			['favorites', 'views', 'tours', 'members'].map((name) =>
				connection.collection(name).find().sort({ _id: 1 }).toArray(),
			),
		);
	}
	async function barrier(ready: Promise<void>) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				ready,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error('Race barrier timed out')), 5000);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
});
