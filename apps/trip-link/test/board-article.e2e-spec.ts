import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { BoardArticleService } from '../src/components/board-article/board-article.service';
import { LikeService } from '../src/components/like/like.service';
import { ViewService } from '../src/components/view/view.service';
import { MemberType } from '../src/libs/enums/member.enum';

jest.setTimeout(60000);
type Actor = { id: Types.ObjectId; token: string };
type Article = {
	_id: string;
	articleTitle: string;
	articleContent: string;
	articleCategory: string;
	articleStatus: string;
	articleViews: number;
	articleLikes: number;
	meLiked: boolean;
	memberId: string;
	memberData?: { memberNick: string } | null;
};
type Result = { data?: Record<string, Article> | null; errors?: Array<{ extensions?: { code?: string } }> };
const fields =
	'_id articleTitle articleContent articleCategory articleStatus articleLikes articleViews memberId meLiked memberData { memberNick }';

describe('Community articles (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let originalMongo: string | undefined;
	let database: string;
	let user: Actor;
	let agent: Actor;
	let otherAgent: Actor;
	let admin: Actor;

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Article tests cannot run in production');
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = `tl_art_e2e_${new Types.ObjectId().toHexString()}`;
		const url = new URL(originalMongo);
		url.pathname = `/${database}`;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.init();
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== database) throw new Error('Unexpected article database');
		for (const name of ['BoardArticle', 'Like', 'View']) await app.get<Model<unknown>>(getModelToken(name)).init();
		user = await actor(MemberType.USER);
		agent = await actor(MemberType.AGENT);
		otherAgent = await actor(MemberType.AGENT);
		admin = await actor(MemberType.ADMIN);
	});
	afterAll(async () => {
		try {
			if (connection && connection.name === database && /^tl_art_e2e_[a-f0-9]{24}$/.test(database))
				await connection.dropDatabase();
		} finally {
			if (app) await app.close();
			if (originalMongo === undefined) delete process.env.MONGO_DEV;
			else process.env.MONGO_DEV = originalMongo;
		}
	});

	it('permits only agent/admin authors, trims content and assigns the authenticated author', async () => {
		const before = await snapshot();
		for (const token of [user.token, '']) expect((await create(token)).errors).toBeDefined();
		expect(await snapshot()).toEqual(before);
		for (const author of [agent, admin]) {
			const response = await create(author.token, {
				articleTitle: '  Travel story  ',
				articleContent: '  Portfolio community content  ',
			});
			expect(response.errors).toBeUndefined();
			expect(response.data?.createBoardArticle).toMatchObject({
				articleStatus: 'ACTIVE',
				memberId: author.id.toHexString(),
				articleTitle: 'Travel story',
				articleContent: 'Portfolio community content',
				articleLikes: 0,
				articleViews: 0,
				meLiked: false,
			});
		}
	});

	it('rejects invalid input, injected ownership/counters and invalid pagination without side effects', async () => {
		const before = await snapshot();
		for (const patch of [
			{ articleTitle: '   ' },
			{ articleContent: 'x'.repeat(2001) },
			{ articleCategory: 'INVALID' },
			{ articleImage: '../../secret.png' },
			{ memberId: user.id.toHexString() },
			{ articleLikes: 30 },
		])
			expect((await create(agent.token, patch)).errors).toBeDefined();
		for (const patch of [{ page: 0 }, { limit: 101 }, { sort: 'memberPassword' }, { search: { memberId: 'bad' } }])
			expect((await list({ page: 1, limit: 10, search: {}, ...patch })).errors).toBeDefined();
		expect(await snapshot()).toEqual(before);
	});

	it('enforces ownership, admin boundaries and terminal soft deletion', async () => {
		const id = await article();
		const before = await snapshot();
		for (const token of [user.token, otherAgent.token])
			expect((await update(id, { articleTitle: 'Unauthorized edit' }, token)).errors).toBeDefined();
		for (const token of [user.token, agent.token]) {
			expect((await update(id, { articleStatus: 'DELETE' }, token, true)).errors).toBeDefined();
			expect((await list({ page: 1, limit: 10, search: {} }, token, true)).errors).toBeDefined();
			expect((await remove(id, token)).errors).toBeDefined();
		}
		expect(await snapshot()).toEqual(before);
		expect((await update(id, { articleTitle: 'Admin edited' }, admin.token, true)).errors).toBeUndefined();
		expect((await update(id, { articleStatus: 'DELETE' })).data?.updateBoardArticle.articleStatus).toBe('DELETE');
		const deleted = await snapshot();
		for (const patch of [{ articleStatus: 'ACTIVE' }, { articleTitle: 'Cannot edit deleted' }])
			expect((await update(id, patch, admin.token, true)).errors).toBeDefined();
		expect((await detail(id)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
		expect((await like(id)).errors?.[0].extensions?.code).toBe('NOT_FOUND');
		expect(await snapshot()).toEqual(deleted);
	});

	it('validates supplied tokens and current account status while allowing anonymous reads', async () => {
		const id = await article();
		expect((await detail(id)).errors).toBeUndefined();
		const before = await snapshot();
		expect((await detail(id, 'invalid')).errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
		for (const status of ['BLOCK', 'SUSPENDED', 'PENDING', 'DELETE']) {
			await connection.collection('members').updateOne({ _id: user.id }, { $set: { memberStatus: status } });
			for (const response of [
				await detail(id, user.token),
				await like(id),
				await list({ page: 1, limit: 10, search: {} }, user.token),
			])
				expect(response.errors).toBeDefined();
		}
		await connection.collection('members').updateOne({ _id: user.id }, { $set: { memberStatus: 'ACTIVE' } });
		expect(await snapshot()).toEqual(before);
		await connection.collection('members').updateOne({ _id: agent.id }, { $set: { memberStatus: 'BLOCK' } });
		expect((await detail(id)).errors).toBeUndefined();
		const blocked = await snapshot();
		expect((await update(id, { articleTitle: 'Blocked edit' })).errors).toBeDefined();
		expect(await snapshot()).toEqual(blocked);
		await connection.collection('members').updateOne({ _id: agent.id }, { $set: { memberStatus: 'ACTIVE' } });
	});

	it('counts each authenticated viewer once and serializes concurrent likes and views', async () => {
		const id = await article();
		await detail(id);
		expect((await detail(id)).data?.getBoardArticle.articleViews).toBe(0);
		const views = await Promise.all([
			detail(id, user.token),
			detail(id, user.token),
			detail(id, agent.token),
			detail(id, admin.token),
		]);
		for (const response of views) expect(response.errors).toBeUndefined();
		expect((await detail(id)).data?.getBoardArticle.articleViews).toBe(3);
		const likes = await Promise.all([like(id), like(id), like(id, agent.token), like(id, admin.token)]);
		for (const response of likes) expect(response.errors).toBeUndefined();
		expect((await detail(id)).data?.getBoardArticle.articleLikes).toBe(2);
		expect((await detail(id, user.token)).data?.getBoardArticle.meLiked).toBe(false);
		expect((await detail(id, agent.token)).data?.getBoardArticle.meLiked).toBe(true);
		expect((await like(id)).data?.likeTargetBoardArticle).toMatchObject({ articleLikes: 3, meLiked: true });
		expect((await like(id)).data?.likeTargetBoardArticle).toMatchObject({ articleLikes: 2, meLiked: false });
	});

	it('filters literal titles, author/category/status, and paginates with stable ordering', async () => {
		const author = await actor(MemberType.AGENT);
		const ids: string[] = [];
		for (const title of ['Trip.* literal', 'Trip other', 'Trip.* second'])
			ids.push(
				(await create(author.token, { articleTitle: title, articleCategory: 'NEWS' })).data!.createBoardArticle._id,
			);
		await update(ids[2], { articleStatus: 'DELETE' }, author.token);
		const input = {
			page: 1,
			limit: 1,
			sort: 'articleLikes',
			direction: 'ASC',
			search: { memberId: author.id.toHexString(), articleCategory: 'NEWS' },
		};
		const first = await list(input);
		const second = await list({ ...input, page: 2 });
		expect(first.data?.getBoardArticles.metaCounter).toEqual([{ total: 2 }]);
		expect(first.data?.getBoardArticles.list[0]._id).not.toBe(second.data?.getBoardArticles.list[0]._id);
		const literal = await list({ ...input, search: { ...input.search, text: 'Trip.*' } });
		expect(literal.data?.getBoardArticles.list.map((row) => row._id)).toEqual([ids[0]]);
		const deleted = await list({ ...input, search: { ...input.search, articleStatus: 'DELETE' } }, admin.token, true);
		expect(deleted.data?.getAllBoardArticlesByAdmin.list.map((row) => row._id)).toEqual([ids[2]]);
	});

	it('projects only public author data and keeps articles when an author is physically missing', async () => {
		const author = await actor(MemberType.AGENT);
		const id = (await create(author.token)).data!.createBoardArticle._id;
		const result = await app.get(BoardArticleService).getBoardArticle(id);
		expect(typeof result.memberData?.memberNick).toBe('string');
		for (const key of ['memberPassword', 'memberEmail', 'memberPhone', 'memberAddress', 'lastLoginAt'])
			expect(result.memberData).not.toHaveProperty(key);
		await connection.collection('members').deleteOne({ _id: author.id });
		expect((await detail(id)).data?.getBoardArticle.memberData).toBeNull();
		expect(
			(await list({ page: 1, limit: 10, search: { memberId: author.id.toHexString() } })).data?.getBoardArticles
				.metaCounter,
		).toEqual([{ total: 1 }]);
	});

	it('hard-removes only deleted articles and their ARTICLE relationships', async () => {
		const id = await article();
		await detail(id, user.token);
		await like(id);
		const before = await snapshot();
		expect((await remove(id)).errors?.[0].extensions?.code).toBe('CONFLICT');
		expect(await snapshot()).toEqual(before);
		const other = await article();
		await like(other);
		const ref = new Types.ObjectId(id);
		await connection.collection('likes').insertOne({ memberId: user.id, likeRefId: ref, likeGroup: 'TOUR' });
		await connection.collection('views').insertOne({ memberId: user.id, viewRefId: ref, viewGroup: 'MEMBER' });
		await update(id, { articleStatus: 'DELETE' });
		expect((await remove(id)).errors).toBeUndefined();
		expect(await connection.collection('boardArticles').findOne({ _id: ref })).toBeNull();
		expect(await connection.collection('likes').countDocuments({ likeRefId: ref, likeGroup: 'ARTICLE' })).toBe(0);
		expect(await connection.collection('views').countDocuments({ viewRefId: ref, viewGroup: 'ARTICLE' })).toBe(0);
		expect(await connection.collection('likes').countDocuments({ likeRefId: ref, likeGroup: 'TOUR' })).toBe(1);
		expect(await connection.collection('views').countDocuments({ viewRefId: ref, viewGroup: 'MEMBER' })).toBe(1);
		expect((await detail(other)).data?.getBoardArticle.articleLikes).toBe(1);
	});

	it('rolls back hard removal if relationship cleanup fails (injected database failure)', async () => {
		const id = await article();
		await like(id);
		await detail(id, user.token);
		await update(id, { articleStatus: 'DELETE' });
		const before = await snapshot();
		const model = app.get<Model<unknown>>(getModelToken('View'));
		const spy = jest.spyOn(model, 'deleteMany').mockImplementationOnce(() => {
			throw new Error('Injected cleanup failure');
		});
		try {
			expect((await remove(id)).errors?.[0].extensions?.code).toBe('INTERNAL_SERVER_ERROR');
		} finally {
			spy.mockRestore();
		}
		expect(await snapshot()).toEqual(before);
	});

	it.each(['like', 'view'])(
		'rolls back a %s racing with soft deletion (controlled interleaving)',
		async (interaction) => {
			const id = await article();
			let reached!: () => void;
			let release!: () => void;
			const ready = new Promise<void>((resolve) => {
				reached = resolve;
			});
			const proceed = new Promise<void>((resolve) => {
				release = resolve;
			});
			const likeService = app.get<LikeService>(LikeService);
			const viewService = app.get<ViewService>(ViewService);
			const countLikes = likeService.countTargetLikes.bind(likeService) as LikeService['countTargetLikes'];
			const countViews = viewService.countTargetViews.bind(viewService) as ViewService['countTargetViews'];
			const spy =
				interaction === 'like'
					? jest.spyOn(likeService, 'countTargetLikes').mockImplementationOnce(async (...args) => {
							const count = await countLikes(...args);
							reached();
							await proceed;
							return count;
						})
					: jest.spyOn(viewService, 'countTargetViews').mockImplementationOnce(async (...args) => {
							const count = await countViews(...args);
							reached();
							await proceed;
							return count;
						});
			const pending = interaction === 'like' ? like(id) : detail(id, user.token);
			try {
				await ready;
				expect((await update(id, { articleStatus: 'DELETE' })).errors).toBeUndefined();
				release();
				expect((await pending).errors).toBeDefined();
			} finally {
				release();
				spy.mockRestore();
			}
			const ref = new Types.ObjectId(id);
			expect(await connection.collection('likes').countDocuments({ likeRefId: ref })).toBe(0);
			expect(await connection.collection('views').countDocuments({ viewRefId: ref })).toBe(0);
			expect(await connection.collection('boardArticles').findOne({ _id: ref })).toMatchObject({
				articleLikes: 0,
				articleViews: 0,
				articleStatus: 'DELETE',
			});
		},
	);

	async function actor(role: MemberType): Promise<Actor> {
		const model = app.get<Model<unknown>>(getModelToken('Member'));
		const id = new Types.ObjectId();
		const nick = `article-${id.toHexString()}`;
		await model.create({
			_id: id,
			memberType: role,
			memberStatus: 'ACTIVE',
			memberNick: nick,
			memberPassword: 'disposable-test-hash',
			memberEmail: `${nick}@example.invalid`,
			memberPhone: id.toHexString(),
			memberAddress: 'Private fixture address',
		});
		return { id, token: await app.get(AuthService).createToken({ _id: id, memberType: role, memberNick: nick }) };
	}
	async function snapshot() {
		return Promise.all(
			['boardArticles', 'likes', 'views'].map((name) => connection.collection(name).find().sort({ _id: 1 }).toArray()),
		);
	}
	function send(query: string, variables: Record<string, unknown>, token = '') {
		const req = request(app.getHttpServer()).post('/graphql');
		if (token) req.set('Authorization', `Bearer ${token}`);
		return req.send({ query, variables }).then((res) => res.body as Result);
	}
	function create(token = agent.token, patch: Record<string, unknown> = {}) {
		return send(
			`mutation($input: BoardArticleInput!) { createBoardArticle(input: $input) { ${fields} } }`,
			{
				input: {
					articleCategory: 'FREE',
					articleTitle: 'Disposable travel article',
					articleContent: 'Disposable portfolio test content',
					...patch,
				},
			},
			token,
		);
	}
	async function article() {
		return (await create()).data!.createBoardArticle._id;
	}
	function detail(id: string, token = '') {
		return send(
			`query($articleId: String!) { getBoardArticle(articleId: $articleId) { ${fields} } }`,
			{ articleId: id },
			token,
		);
	}
	function like(id: string, token = user.token) {
		return send(
			`mutation($articleId: String!) { likeTargetBoardArticle(articleId: $articleId) { ${fields} } }`,
			{ articleId: id },
			token,
		);
	}
	function update(id: string, patch: Record<string, unknown>, token = agent.token, adminOperation = false) {
		const operation = adminOperation ? 'updateBoardArticleByAdmin' : 'updateBoardArticle';
		return send(
			`mutation($input: BoardArticleUpdate!) { ${operation}(input: $input) { ${fields} } }`,
			{ input: { _id: id, ...patch } },
			token,
		);
	}
	function remove(id: string, token = admin.token) {
		return send(
			`mutation($articleId: String!) { removeBoardArticleByAdmin(articleId: $articleId) { ${fields} } }`,
			{ articleId: id },
			token,
		);
	}
	async function list(input: Record<string, unknown>, token = '', adminOperation = false) {
		const operation = adminOperation ? 'getAllBoardArticlesByAdmin' : 'getBoardArticles';
		const type = adminOperation ? 'AllBoardArticlesInquiry' : 'BoardArticlesInquiry';
		const response = await send(
			`query($input: ${type}!) { ${operation}(input: $input) { list { ${fields} } metaCounter { total } } }`,
			{ input },
			token,
		);
		return response as unknown as {
			data?: Record<string, { list: Article[]; metaCounter: Array<{ total: number }> }>;
			errors?: Result['errors'];
		};
	}
});
