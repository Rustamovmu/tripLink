import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { CommentService } from '../src/components/comment/comment.service';
import { MemberType } from '../src/libs/enums/member.enum';

jest.setTimeout(60000);
type Actor = { id: Types.ObjectId; token: string };
type Row = {
	_id: string;
	memberId: string;
	commentContent: string;
	commentStatus: string;
	commentGroup: string;
	memberData: { memberNick: string } | null;
};
type Result = {
	data?: Record<string, Row & { list: Row[]; metaCounter: { total: number }[] }> | null;
	errors?: { extensions: { code: string } }[];
};
const fields = '_id memberId commentContent commentStatus commentGroup memberData { memberNick }';

describe('Article comments (e2e)', () => {
	let app: INestApplication;
	let connection: Connection;
	let database: string;
	let originalMongo: string | undefined;
	let user: Actor;
	let agent: Actor;
	let admin: Actor;
	let stranger: Actor;
	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Comment tests cannot run in production');
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = `tl_cmt_e2e_${new Types.ObjectId().toHexString()}`;
		const url = new URL(originalMongo);
		url.pathname = `/${database}`;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.init();
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== database) throw new Error('Unexpected comment database');
		for (const name of ['Comment', 'BoardArticle', 'Member']) await app.get<Model<unknown>>(getModelToken(name)).init();
		user = await actor(MemberType.USER);
		agent = await actor(MemberType.AGENT);
		admin = await actor(MemberType.ADMIN);
		stranger = await actor(MemberType.USER);
	});
	afterAll(async () => {
		try {
			if (connection && connection.name === database && /^tl_cmt_e2e_[a-f0-9]{24}$/.test(database))
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
	it('allows all active roles, trims content, uses authenticated ownership and public reads', async () => {
		const ref = await article();
		for (const actor of [user, agent, admin]) {
			const response = await create(ref, actor.token, { commentContent: '  Helpful story!  ' });
			expect(response.errors).toBeUndefined();
			expect(response.data?.createComment).toMatchObject({
				memberId: actor.id.toHexString(),
				commentContent: 'Helpful story!',
				commentStatus: 'ACTIVE',
				commentGroup: 'ARTICLE',
			});
		}
		expect((await list(ref)).data?.getComments.metaCounter).toEqual([{ total: 3 }]);
		expect(await count(ref)).toBe(3);
	});
	it('rejects unauthenticated writes, spoofed fields, invalid content/IDs and pagination without writes', async () => {
		const ref = await article();
		const before = await snapshot();
		for (const token of ['', 'bad'])
			expect((await create(ref, token)).errors?.[0].extensions.code).toBe('UNAUTHENTICATED');
		for (const patch of [
			{ commentContent: ' ' },
			{ commentContent: 'x'.repeat(101) },
			{ commentRefId: 'bad' },
			{ commentContent: null },
			{ memberId: admin.id.toHexString() },
			{ commentStatus: 'DELETE' },
			{ commentGroup: 'TOUR' },
		])
			expect((await create(ref, user.token, patch)).errors).toBeDefined();
		for (const patch of [
			{ page: 0 },
			{ limit: 101 },
			{ sort: 'memberPassword' },
			{ search: { commentRefId: 'bad' } },
			{ search: { commentRefId: ref, commentStatus: 'DELETE' } },
		])
			expect((await list(ref, '', false, patch)).errors).toBeDefined();
		expect(await snapshot()).toEqual(before);
	});
	it('validates supplied tokens, account status and stale roles on reads and writes', async () => {
		const ref = await article();
		const before = await snapshot();
		expect((await list(ref, 'bad')).errors?.[0].extensions.code).toBe('UNAUTHENTICATED');
		try {
			for (const status of ['BLOCK', 'SUSPENDED', 'PENDING', 'DELETE']) {
				await connection.collection('members').updateOne({ _id: user.id }, { $set: { memberStatus: status } });
				expect((await create(ref)).errors).toBeDefined();
				expect((await list(ref, user.token)).errors).toBeDefined();
			}
			await connection
				.collection('members')
				.updateOne({ _id: user.id }, { $set: { memberStatus: 'ACTIVE', memberType: 'AGENT' } });
			expect((await create(ref)).errors?.[0].extensions.code).toBe('UNAUTHENTICATED');
		} finally {
			await connection
				.collection('members')
				.updateOne({ _id: user.id }, { $set: { memberStatus: 'ACTIVE', memberType: 'USER' } });
		}
		expect(await snapshot()).toEqual(before);
	});
	it('enforces ownership, terminal deletion, admin-only moderation and exact counts', async () => {
		const ref = await article();
		const id = (await create(ref)).data!.createComment._id;
		for (const token of [stranger.token, agent.token])
			expect((await update(id, { commentContent: 'Unauthorized' }, token)).errors?.[0].extensions.code).toBe(
				'NOT_FOUND',
			);
		for (const token of [user.token, agent.token]) {
			expect((await update(id, { commentStatus: 'DELETE' }, token, true)).errors?.[0].extensions.code).toBe(
				'FORBIDDEN',
			);
			expect((await list(ref, token, true)).errors?.[0].extensions.code).toBe('FORBIDDEN');
			expect((await remove(id, token)).errors?.[0].extensions.code).toBe('FORBIDDEN');
		}
		expect((await remove(id)).errors?.[0].extensions.code).toBe('CONFLICT');
		for (const patch of [{}, { commentContent: null }, { commentStatus: 'ACTIVE' }])
			expect((await update(id, patch)).errors).toBeDefined();
		expect((await update(id, { commentContent: '  Edited  ' })).data?.updateComment.commentContent).toBe('Edited');
		expect(await count(ref)).toBe(1);
		expect((await update(id, { commentStatus: 'DELETE' }, admin.token, true)).errors).toBeUndefined();
		expect(await count(ref)).toBe(0);
		expect((await list(ref)).data?.getComments.list).toEqual([]);
		expect(
			(await list(ref, admin.token, true, { search: { commentRefId: ref, commentStatus: 'DELETE' } })).data
				?.getAllCommentsByAdmin.metaCounter,
		).toEqual([{ total: 1 }]);
		expect((await update(id, { commentContent: 'Cannot restore' })).errors?.[0].extensions.code).toBe('NOT_FOUND');
		expect((await remove(id)).errors).toBeUndefined();
		expect(await count(ref)).toBe(0);
	});
	it('hides comments on deleted articles, permits owner removal, and rejects missing parents', async () => {
		const ref = await article();
		const id = (await create(ref)).data!.createComment._id;
		await hide(ref);
		for (const response of [
			await list(ref),
			await create(ref),
			await update(id, { commentContent: 'Hidden edit' }),
			await create(new Types.ObjectId().toHexString()),
		])
			expect(response.errors?.[0].extensions.code).toBe('NOT_FOUND');
		expect((await list(ref, admin.token, true)).data?.getAllCommentsByAdmin.list).toHaveLength(1);
		expect((await update(id, { commentStatus: 'DELETE' })).errors).toBeUndefined();
		expect(await count(ref)).toBe(0);
	});
	it('paginates stably, isolates ARTICLE records, and projects only public author fields', async () => {
		const ref = await article();
		for (let i = 0; i < 3; i++) await create(ref);
		await connection
			.collection('comments')
			.insertOne({ commentRefId: new Types.ObjectId(ref), commentGroup: 'TOUR', commentStatus: 'ACTIVE' });
		const first = await list(ref, '', false, { limit: 1, direction: 'ASC' });
		const second = await list(ref, '', false, { page: 2, limit: 1, direction: 'ASC' });
		expect(first.data?.getComments.metaCounter).toEqual([{ total: 3 }]);
		expect(first.data?.getComments.list[0]._id).not.toBe(second.data?.getComments.list[0]._id);
		const result = await app.get(CommentService).getComments({ page: 1, limit: 10, search: { commentRefId: ref } });
		for (const row of result.list)
			for (const key of ['memberPassword', 'memberEmail', 'memberPhone', 'memberAddress', 'lastLoginAt'])
				expect(row.memberData).not.toHaveProperty(key);
		const disposable = await actor(MemberType.USER);
		await create(ref, disposable.token);
		await connection.collection('members').deleteOne({ _id: disposable.id });
		expect(
			(await list(ref)).data?.getComments.list.find((row) => row.memberId === disposable.id.toHexString())?.memberData,
		).toBeNull();
	});
	it('serializes concurrent creates and duplicate deletes without counter drift', async () => {
		const ref = await article();
		const creates = await Promise.all([create(ref), create(ref), create(ref, agent.token), create(ref, admin.token)]);
		for (const response of creates) expect(response.errors).toBeUndefined();
		expect(await count(ref)).toBe(4);
		const id = creates[0].data!.createComment._id;
		const deletes = await Promise.all([
			update(id, { commentStatus: 'DELETE' }),
			update(id, { commentStatus: 'DELETE' }),
		]);
		expect(deletes.filter((response) => !response.errors)).toHaveLength(1);
		expect(await count(ref)).toBe(3);
	});
	it('rolls back creation and deletion when the parent counter write fails', async () => {
		const ref = await article();
		const id = (await create(ref)).data!.createComment._id;
		const model = app.get<Model<unknown>>(getModelToken('BoardArticle'));
		for (const action of [() => create(ref), () => update(id, { commentStatus: 'DELETE' })]) {
			const before = await snapshot();
			const spy = jest.spyOn(model, 'findOneAndUpdate').mockImplementationOnce(() => {
				throw new Error('Injected comment count failure');
			});
			try {
				expect((await action()).errors?.[0].extensions.code).toBe('INTERNAL_SERVER_ERROR');
			} finally {
				spy.mockRestore();
			}
			expect(await snapshot()).toEqual(before);
		}
	});
	it.each(['create', 'edit'])(
		'rolls back %s racing with article deletion (controlled interleaving)',
		async (action) => {
			const ref = await article();
			const id = (await create(ref)).data!.createComment._id;
			const model = app.get<Model<unknown>>(getModelToken('Comment'));
			const countDocuments = model.countDocuments.bind(model) as Model<unknown>['countDocuments'];
			let reached!: () => void;
			let release!: () => void;
			const ready = new Promise<void>((resolve) => {
				reached = resolve;
			});
			const proceed = new Promise<void>((resolve) => {
				release = resolve;
			});
			const spy = jest.spyOn(model, 'countDocuments').mockImplementationOnce((...args) => {
				const query = countDocuments(...args);
				const exec = query.exec.bind(query) as () => Promise<number>;
				query.exec = async () => {
					const count = await exec();
					reached();
					await proceed;
					return count;
				};
				return query;
			});
			const pending = action === 'create' ? create(ref) : update(id, { commentContent: 'Racing edit' });
			try {
				await ready;
				await hide(ref);
				release();
				expect((await pending).errors).toBeDefined();
			} finally {
				release();
				await pending;
				spy.mockRestore();
			}
			expect(await count(ref)).toBe(1);
			expect(await connection.collection('comments').countDocuments({ commentRefId: new Types.ObjectId(ref) })).toBe(1);
			expect((await connection.collection('comments').findOne({ _id: new Types.ObjectId(id) }))?.commentContent).toBe(
				'Helpful article',
			);
		},
	);
	async function actor(role: MemberType): Promise<Actor> {
		const id = new Types.ObjectId();
		const nick = `comment-${id.toHexString()}`;
		const model = app.get<Model<unknown>>(getModelToken('Member'));
		await model.create({
			_id: id,
			memberType: role,
			memberStatus: 'ACTIVE',
			memberNick: nick,
			memberPassword: 'disposable-hash',
			memberEmail: `${nick}@example.invalid`,
			memberPhone: id.toHexString(),
			memberAddress: 'Private fixture',
		});
		return { id, token: await app.get(AuthService).createToken({ _id: id, memberType: role, memberNick: nick }) };
	}
	async function article(): Promise<string> {
		const model = app.get<Model<unknown>>(getModelToken('BoardArticle'));
		const row = await model.create({
			articleCategory: 'FREE',
			articleTitle: 'Disposable comment article',
			articleContent: 'Disposable test content',
			memberId: agent.id,
		});
		return String(row._id);
	}
	async function hide(ref: string) {
		const response = await send(
			'mutation($input: BoardArticleUpdate!) { updateBoardArticle(input: $input) { _id } }',
			{ input: { _id: ref, articleStatus: 'DELETE' } },
			agent.token,
		);
		expect(response.errors).toBeUndefined();
	}
	async function count(ref: string) {
		return (
			await connection
				.collection<{ _id: Types.ObjectId; articleComments: number }>('boardArticles')
				.findOne({ _id: new Types.ObjectId(ref) })
		)?.articleComments;
	}
	async function snapshot() {
		return Promise.all(
			['comments', 'boardArticles'].map((name) => connection.collection(name).find().sort({ _id: 1 }).toArray()),
		);
	}
	function send(query: string, variables: Record<string, unknown>, token = '') {
		const req = request(app.getHttpServer()).post('/graphql');
		if (token) req.set('Authorization', `Bearer ${token}`);
		return req.send({ query, variables }).then((res) => res.body as Result);
	}
	function create(ref: string, token = user.token, patch: Record<string, unknown> = {}) {
		return send(
			`mutation($input: CommentInput!) { createComment(input: $input) { ${fields} } }`,
			{ input: { commentRefId: ref, commentContent: 'Helpful article', ...patch } },
			token,
		);
	}
	function update(id: string, patch: Record<string, unknown>, token = user.token, adminOperation = false) {
		const operation = adminOperation ? 'updateCommentByAdmin' : 'updateComment';
		return send(
			`mutation($input: CommentUpdate!) { ${operation}(input: $input) { ${fields} } }`,
			{ input: { _id: id, ...patch } },
			token,
		);
	}
	function remove(id: string, token = admin.token) {
		return send(
			`mutation($commentId: String!) { removeCommentByAdmin(commentId: $commentId) { ${fields} } }`,
			{ commentId: id },
			token,
		);
	}
	function list(ref: string, token = '', adminOperation = false, patch: Record<string, unknown> = {}) {
		const operation = adminOperation ? 'getAllCommentsByAdmin' : 'getComments';
		const type = adminOperation ? 'AllCommentsInquiry' : 'CommentsInquiry';
		return send(
			`query($input: ${type}!) { ${operation}(input: $input) { list { ${fields} } metaCounter { total } } }`,
			{ input: { page: 1, limit: 10, search: { commentRefId: ref }, ...patch } },
			token,
		);
	}
});
