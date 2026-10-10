import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { MemberService } from '../src/components/member/member.service';
import { TourService } from '../src/components/tour/tour.service';
import { MemberType } from '../src/libs/enums/member.enum';
import { TourStatus } from '../src/libs/enums/tour.enum';

type Actor = { id: Types.ObjectId; token: string };
type Row = {
	_id: string;
	agentId: string;
	tourTitle: string;
	tourSlug: string;
	tourStatus: string;
	tourFeatured: boolean;
	tourDiscountPrice?: number;
	agentData?: { memberNick: string } | null;
};
type Page = { list: Row[]; metaCounter: Array<{ total: number }> };
type Response = {
	data?: {
		createTour?: Row;
		updateTour?: Row;
		updateTourByAdmin?: Row;
		getTours?: Page;
		getAgentTours?: Page;
		getAllToursByAdmin?: Page;
	} | null;
	errors?: Array<{ extensions?: { code?: string } }>;
};
const fields = '_id agentId tourTitle tourSlug tourStatus tourFeatured tourDiscountPrice agentData { memberNick }';
jest.setTimeout(45000);

describe('Tour CRUD, search and publication (real GraphQL e2e)', () => {
	let app: INestApplication | undefined;
	let connection: Connection | undefined;
	let originalMongo: string | undefined;
	let database: string;
	let agent: Actor;
	let otherAgent: Actor;
	let user: Actor;
	let admin: Actor;

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Tour tests cannot run in production');
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = `tl_tour_e2e_${new Types.ObjectId().toHexString()}`;
		const url = new URL(originalMongo);
		url.pathname = `/${database}`;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] })
			.setLogger({ log: () => undefined, error: () => undefined, warn: () => undefined })
			.compile();
		app = module.createNestApplication();
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== database) throw new Error('Unexpected tour database');
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.init();
		await app.get<Model<unknown>>(getModelToken('Tour')).init();
		agent = await actor(MemberType.AGENT);
		otherAgent = await actor(MemberType.AGENT);
		user = await actor(MemberType.USER);
		admin = await actor(MemberType.ADMIN);
	});
	beforeEach(async () => {
		await db().collection('tours').deleteMany({});
		await db()
			.collection('members')
			.updateMany({}, { $set: { memberTours: 0 } });
	});
	afterAll(async () => {
		try {
			if (connection && connection.name === database && /^tl_tour_e2e_[a-f0-9]{24}$/.test(database))
				await connection.dropDatabase();
		} finally {
			try {
				if (app) await app.close();
			} finally {
				if (originalMongo === undefined) delete process.env.MONGO_DEV;
				else process.env.MONGO_DEV = originalMongo;
			}
		}
	});

	it('creates trimmed drafts with authenticated authors, distinct slugs and exact member counters', async () => {
		const rows = await Promise.all([
			create({ tourTitle: '  Café Seoul walking tour  ' }),
			create({ tourTitle: '  Café Seoul walking tour  ' }),
		]);
		for (const response of rows) {
			expect(response.errors).toBeUndefined();
			expect(response.data?.createTour).toMatchObject({
				agentId: agent.id.toHexString(),
				tourTitle: 'Café Seoul walking tour',
				tourStatus: 'DRAFT',
				tourFeatured: false,
			});
			expect(response.data?.createTour?.tourSlug).toMatch(/^cafe-seoul-walking-tour-[a-f0-9]{8}$/);
		}
		expect(new Set(rows.map((row) => row.data?.createTour?.tourSlug)).size).toBe(2);
		expect(await db().collection('members').findOne({ _id: agent.id })).toMatchObject({ memberTours: 2 });
		expect((await list('getTours')).data?.getTours?.list).toEqual([]);
	});

	it('rejects unauthorized authors and injected authors, counters or status without side effects', async () => {
		const before = await snapshot();
		for (const token of ['', user.token, admin.token]) expect((await create({}, token)).errors).toBeDefined();
		for (const patch of [{ agentId: otherAgent.id.toHexString() }, { tourViewCount: 100 }, { tourStatus: 'ACTIVE' }])
			expect((await create(patch)).errors).toBeDefined();
		expect(await snapshot()).toEqual(before);
	});

	it('rejects invalid nested dates, seats, discounts, itineraries and explicit nulls without side effects', async () => {
		const before = await snapshot();
		for (const patch of [
			{ tourTitle: 'bad' },
			{ tourTitle: null },
			{ tourDiscountPrice: 101 },
			{ tourPrice: -1 },
			{ tourAvailableSeats: 9 },
			{ tourAvailableDates: [{ startDate: '2035-01-03', endDate: '2035-01-01', availableSeats: 10 }] },
			{ tourAvailableDates: [{ startDate: 'invalid', endDate: '2035-01-03', availableSeats: 10 }] },
			{ tourItinerary: [{ day: 2, title: 'Day two', description: 'Invalid day for one day tour' }] },
			{ tourItinerary: [input().tourItinerary[0], input().tourItinerary[0]] },
		])
			expect((await create(patch)).errors).toBeDefined();
		expect(await snapshot()).toEqual(before);
	});

	it('rejects titles below minimum length after trimming on creation and editing (regression)', async () => {
		const id = await seed();
		const before = await snapshot();
		const responses = [await create({ tourTitle: '    x    ' }), await edit(id, { tourTitle: '    x    ' })];
		for (const response of responses) expect(response.errors).toBeDefined();
		expect(await snapshot()).toEqual(before);
	});

	it('isolates agent ownership and requires complete content before submission and admin publication', async () => {
		const created = await create();
		expect(created.errors).toBeUndefined();
		const id = created.data!.createTour!._id;
		const before = await snapshot();
		expect((await edit(id, { tourTitle: 'Another agent edit' }, otherAgent.token)).errors?.[0].extensions?.code).toBe(
			'NOT_FOUND',
		);
		expect((await edit(id, { tourStatus: 'ACTIVE' })).errors?.[0].extensions?.code).toBe('FORBIDDEN');
		expect(await snapshot()).toEqual(before);
		expect((await edit(id, { tourStatus: 'PENDING', tourImages: [] })).errors).toBeDefined();
		expect((await edit(id, { tourStatus: 'PENDING' })).errors).toBeUndefined();
		expect((await moderate(id, { tourStatus: 'ACTIVE', tourFeatured: true })).errors).toBeUndefined();
		expect((await list('getTours')).data?.getTours?.list.map((row) => row._id)).toEqual([id]);
		expect((await list('getAgentTours', {}, otherAgent.token)).data?.getAgentTours?.list).toEqual([]);
	});

	it('features and unfeatures an active tour without supplying or changing status (regression)', async () => {
		const id = await seed({ tourStatus: TourStatus.ACTIVE, tourFeatured: false });
		for (const tourFeatured of [true, false]) {
			const response = await moderate(id, { tourFeatured });
			expect(response.errors).toBeUndefined();
			expect(response.data?.updateTourByAdmin).toMatchObject({ tourStatus: 'ACTIVE', tourFeatured });
			expect(
				await db()
					.collection('tours')
					.findOne({ _id: new Types.ObjectId(id) }),
			).toMatchObject({ tourStatus: 'ACTIVE', tourFeatured });
		}
		const before = await snapshot();
		expect((await moderate(id, { tourFeatured: null })).errors).toBeDefined();
		expect((await moderate(id, {})).errors).toBeDefined();
		expect((await moderate(id, { tourFeatured: true }, user.token)).errors?.[0].extensions?.code).toBe('FORBIDDEN');
		expect(await snapshot()).toEqual(before);
	});

	it('clears featured status when the owning agent cancels a tour (regression)', async () => {
		const id = await seed({ tourStatus: TourStatus.ACTIVE, tourFeatured: true });
		const response = await edit(id, { tourStatus: 'CANCELLED' });
		expect(response.errors).toBeUndefined();
		expect(response.data?.updateTour).toMatchObject({ tourStatus: 'CANCELLED', tourFeatured: false });
	});

	it('allows anonymous listing but validates supplied malformed and disabled-account tokens (regression)', async () => {
		await seed({ tourStatus: TourStatus.ACTIVE });
		const disabled = await actor(MemberType.USER);
		await db()
			.collection('members')
			.updateOne({ _id: disabled.id }, { $set: { memberStatus: 'BLOCK' } });
		const before = await snapshot();
		expect((await list('getTours')).errors).toBeUndefined();
		const responses = [await list('getTours', {}, 'invalid-token'), await list('getTours', {}, disabled.token)];
		expect(responses[0].errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		expect(responses[1].errors?.[0].extensions?.code).toBe('FORBIDDEN');
		expect(await snapshot()).toEqual(before);
	});

	it('combines public filters, matches text across indexed fields, and counts before pagination', async () => {
		const first = await seed({
			tourStatus: TourStatus.ACTIVE,
			tourTitle: 'Mountain Seoul adventure',
			tourDiscountPrice: 40,
			tourAverageRating: 4.5,
			tourFeatured: true,
		});
		const second = await seed({
			tourStatus: TourStatus.SOLD_OUT,
			tourTitle: 'Mountain Seoul second',
			tourDiscountPrice: 45,
			tourAverageRating: 4.5,
			tourFeatured: true,
		});
		await seed({ tourStatus: TourStatus.DRAFT, tourTitle: 'Mountain Seoul hidden' });
		await seed({ tourStatus: TourStatus.ACTIVE, tourCountry: 'Japan', tourCity: 'Tokyo' });
		const search = {
			agentId: agent.id.toHexString(),
			destinations: ['Seoul'],
			countries: ['Korea'],
			cities: ['Seoul'],
			categories: ['CITY'],
			difficulties: ['EASY'],
			priceRange: { start: 30, end: 50 },
			durationRange: { start: 1, end: 2 },
			minimumRating: 4,
			featured: true,
			text: 'Mountain',
		};
		const page1 = (await list('getTours', { page: 1, limit: 1, sort: 'tourPrice', direction: 'ASC', search })).data
			?.getTours;
		const page2 = (await list('getTours', { page: 2, limit: 1, sort: 'tourPrice', direction: 'ASC', search })).data
			?.getTours;
		expect(page1?.metaCounter).toEqual([{ total: 2 }]);
		expect(page1?.list.map((row) => row._id)).toEqual([first]);
		expect(page2?.list.map((row) => row._id)).toEqual([second]);
	});

	it('uses discounted prices including zero and requires seats on the overlapping departure', async () => {
		const free = await seed({ tourStatus: TourStatus.ACTIVE, tourDiscountPrice: 0 });
		await seed({
			tourStatus: TourStatus.ACTIVE,
			tourAvailableDates: [
				{ startDate: '2035-01-01', endDate: '2035-01-02', availableSeats: 0 },
				{ startDate: '2036-01-01', endDate: '2036-01-02', availableSeats: 10 },
			],
		});
		const result = await list('getTours', { search: { priceRange: { start: 0, end: 0 } } });
		expect(result.data?.getTours?.list.map((row) => row._id)).toEqual([free]);
		const dated = await list('getTours', {
			search: { availableDateRange: { start: '2035-01-01', end: '2035-01-02' }, minimumAvailableSeats: 1 },
		});
		expect(dated.data?.getTours?.list.map((row) => row._id)).toEqual([free]);
	});

	it('enforces list role boundaries, pagination, sort and range validation without writes', async () => {
		await seed();
		const before = await snapshot();
		for (const token of ['', user.token, otherAgent.token])
			expect((await list('getAllToursByAdmin', {}, token)).errors).toBeDefined();
		for (const token of ['', user.token, admin.token])
			expect((await list('getAgentTours', {}, token)).errors).toBeDefined();
		for (const patch of [
			{ page: 0 },
			{ limit: 101 },
			{ page: 1.5 },
			{ sort: 'agentId' },
			{ search: { priceRange: { start: 10, end: 5 } } },
			{ search: { agentId: 'bad' } },
		])
			expect((await list('getTours', patch)).errors).toBeDefined();
		expect(
			(
				await list(
					'getAllToursByAdmin',
					{ search: { tourStatus: 'DRAFT', agentId: agent.id.toHexString() } },
					admin.token,
				)
			).data?.getAllToursByAdmin?.metaCounter,
		).toEqual([{ total: 1 }]);
		expect(await snapshot()).toEqual(before);
	});

	it('excludes private author fields at the service boundary and retains tours with missing authors', async () => {
		const id = await seed({ tourStatus: TourStatus.ACTIVE });
		const service = app!.get<TourService>(TourService);
		for (const row of [
			(await service.getTours({ page: 1, limit: 10, search: {} })).list[0],
			await service.getTour(id),
		]) {
			for (const field of ['memberPassword', 'memberEmail', 'memberPhone', 'memberPhoneCountryCode', 'memberAddress'])
				expect(row.agentData).not.toHaveProperty(field);
		}
		const missing = await actor(MemberType.AGENT);
		const orphan = await seed({ tourStatus: TourStatus.ACTIVE, agentId: missing.id });
		await db().collection('members').deleteOne({ _id: missing.id });
		const result = (await list('getTours')).data?.getTours;
		expect(result?.metaCounter).toEqual([{ total: 2 }]);
		expect(result?.list.find((row) => row._id === orphan)?.agentData).toBeNull();
	});

	it('removes a newly saved tour if its member counter fails (injected database failure)', async () => {
		const before = await snapshot();
		const spy = jest
			.spyOn(app!.get<MemberService>(MemberService), 'increaseMemberTourCount')
			.mockRejectedValueOnce(new Error('Injected counter failure'));
		try {
			expect((await create()).errors?.[0].extensions?.code).toBe('INTERNAL_SERVER_ERROR');
			expect(await snapshot()).toEqual(before);
		} finally {
			spy.mockRestore();
		}
	});

	function db(): Connection {
		if (!connection || connection.name !== database || !/^tl_tour_e2e_[a-f0-9]{24}$/.test(database))
			throw new Error('Unsafe tour database');
		return connection;
	}
	async function actor(role: MemberType): Promise<Actor> {
		const id = new Types.ObjectId();
		const nick = `tour-${id.toHexString()}`;
		const members = app!.get<Model<unknown>>(getModelToken('Member'));
		await members.create({
			_id: id,
			memberNick: nick,
			memberType: role,
			memberStatus: 'ACTIVE',
			memberPassword: 'disposable-test-hash',
			memberEmail: `${nick}@example.invalid`,
			memberPhone: id.toHexString(),
			memberAddress: 'Private disposable address',
		});
		return {
			id,
			token: await app!.get<AuthService>(AuthService).createToken({ _id: id, memberNick: nick, memberType: role }),
		};
	}
	function input() {
		return {
			tourTitle: 'Disposable Seoul walking tour',
			tourDescription: 'Disposable tour used only for isolated integration tests.',
			tourDestination: 'Seoul',
			tourCountry: 'Korea',
			tourCity: 'Seoul',
			tourImages: ['uploads/tour/disposable.png'],
			tourPrice: 100,
			tourDurationDays: 1,
			tourAvailableDates: [
				{ startDate: '2035-01-01T00:00:00.000Z', endDate: '2035-01-02T00:00:00.000Z', availableSeats: 10 },
			],
			tourAvailableSeats: 10,
			tourMaxGroupSize: 10,
			tourCategory: 'CITY',
			tourDifficulty: 'EASY',
			tourLanguages: ['English'],
			tourTransportation: [],
			tourMeals: [],
			tourItinerary: [{ day: 1, title: 'Walking day', description: 'Walk around the disposable destination' }],
			tourIncludedServices: [],
			tourExcludedServices: [],
		};
	}
	async function seed(patch: Record<string, unknown> = {}): Promise<string> {
		const id = new Types.ObjectId();
		await app!
			.get<Model<unknown>>(getModelToken('Tour'))
			.create({ ...input(), _id: id, tourSlug: `disposable-${id.toHexString()}`, agentId: agent.id, ...patch });
		return id.toHexString();
	}
	function send(query: string, variables: Record<string, unknown>, token = ''): Promise<Response> {
		const req = request(app!.getHttpServer()).post('/graphql');
		if (token) req.set('Authorization', `Bearer ${token}`);
		return req.send({ query, variables }).then((res) => res.body as Response);
	}
	function create(patch: Record<string, unknown> = {}, token = agent.token) {
		return send(
			`mutation($input: TourInput!) { createTour(input: $input) { ${fields} } }`,
			{ input: { ...input(), ...patch } },
			token,
		);
	}
	function edit(id: string, patch: Record<string, unknown>, token = agent.token) {
		return send(
			`mutation($input: TourUpdate!) { updateTour(input: $input) { ${fields} } }`,
			{ input: { tourId: id, ...patch } },
			token,
		);
	}
	function moderate(id: string, patch: Record<string, unknown>, token = admin.token) {
		return send(
			`mutation($input: TourAdminUpdate!) { updateTourByAdmin(input: $input) { ${fields} } }`,
			{ input: { tourId: id, ...patch } },
			token,
		);
	}
	function list(
		action: 'getTours' | 'getAgentTours' | 'getAllToursByAdmin',
		patch: Record<string, unknown> = {},
		token = '',
	) {
		const type =
			action === 'getTours' ? 'ToursInquiry' : action === 'getAgentTours' ? 'AgentToursInquiry' : 'AllToursInquiry';
		return send(
			`query($input: ${type}!) { ${action}(input: $input) { list { ${fields} } metaCounter { total } } }`,
			{ input: { page: 1, limit: 100, search: {}, ...patch } },
			token,
		);
	}
	function snapshot() {
		return Promise.all(['tours', 'members'].map((name) => db().collection(name).find().sort({ _id: 1 }).toArray()));
	}
});
