import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { MemberType } from '../src/libs/enums/member.enum';

jest.setTimeout(120000);
type Entry = {
	_id: string;
	memberId: string;
	noticeTitle: string;
	noticeContent: string;
	noticeStatus: string;
	faqTopic: string | null;
};
type Result = {
	data?: Record<string, Entry & { list: Entry[]; metaCounter: { total: number }[] }> | null;
	errors?: { extensions: { code: string } }[];
};
const fields = '_id memberId noticeTitle noticeContent noticeCategory noticeStatus faqTopic createdAt updatedAt';
const createQuery = `mutation($input: HelpEntryInput!) { createHelpEntry(input: $input) { ${fields} } }`;
const updateQuery = `mutation($input: HelpEntryUpdate!) { updateHelpEntry(input: $input) { ${fields} } }`;
const listQuery = `query($input: HelpEntriesInquiry!) { getHelpEntries(input: $input) { list { ${fields} } metaCounter { total } } }`;
const adminQuery = `query($input: AdminHelpEntriesInquiry!) { getAllHelpEntriesByAdmin(input: $input) { list { ${fields} } metaCounter { total } } }`;
const detailQuery = `query($entryId: String!) { getHelpEntry(entryId: $entryId) { ${fields} } }`;
const removeQuery = 'mutation($entryId: String!) { removeHelpEntry(entryId: $entryId) }';

describe('Help Center API (disposable MongoDB)', () => {
	let app: INestApplication;
	let connection: Connection;
	const database = `tl_help_${new Types.ObjectId().toHexString()}`;
	const originalMongo = process.env.MONGO_DEV;
	const actors: Record<string, { id: Types.ObjectId; token: string }> = {};
	const assertDatabase = () => {
		if (connection.name !== database || !/^tl_help_[a-f0-9]{24}$/.test(database))
			throw new Error('Unsafe help-test database');
	};
	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production' || !originalMongo) throw new Error('Development Mongo URI required');
		const uri = new URL(originalMongo);
		uri.pathname = `/${database}`;
		process.env.MONGO_DEV = uri.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = module.createNestApplication({ logger: false });
		connection = app.get<Connection>(getConnectionToken());
		assertDatabase();
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		await app.init();
		for (const role of [MemberType.ADMIN, MemberType.USER, MemberType.AGENT]) {
			const id = new Types.ObjectId();
			const memberNick = 'disposable-help-' + role;
			await connection
				.collection('members')
				.insertOne({ _id: id, memberNick, memberType: role, memberStatus: 'ACTIVE' });
			actors[role] = { id, token: await app.get(AuthService).createToken({ _id: id, memberNick, memberType: role }) };
		}
	});
	beforeEach(async () => {
		assertDatabase();
		await connection.collection('notices').deleteMany({});
	});
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
				if (originalMongo === undefined) delete process.env.MONGO_DEV;
				else process.env.MONGO_DEV = originalMongo;
			}
		}
	});
	async function call(query: string, variables: Record<string, unknown>, token?: string): Promise<Result> {
		const req = request(app.getHttpServer()).post('/graphql');
		if (token) req.set('Authorization', `Bearer ${token}`);
		return (await req.send({ query, variables })).body as Result;
	}
	const inquiry = (search = {}, page = 1, limit = 10) => ({ input: { page, limit, search } });
	async function create(patch: Record<string, unknown> = {}, token = actors.ADMIN.token) {
		return call(
			createQuery,
			{
				input: {
					noticeCategory: 'FAQ',
					faqTopic: 'BOOKINGS',
					noticeTitle: '  How are seats reserved?  ',
					noticeContent: '  Confirmation reserves seats.  ',
					...patch,
				},
			},
			token,
		);
	}
	async function fixture(patch: Record<string, unknown> = {}) {
		const response = await create(patch);
		expect(response.errors).toBeUndefined();
		return response.data!.createHelpEntry;
	}
	it('creates a trimmed draft under the authenticated admin, then publishes, edits and unpublishes', async () => {
		const entry = await fixture();
		expect(entry).toMatchObject({
			noticeStatus: 'HOLD',
			memberId: actors.ADMIN.id.toHexString(),
			noticeTitle: 'How are seats reserved?',
			noticeContent: 'Confirmation reserves seats.',
		});
		expect((await call(detailQuery, { entryId: entry._id })).errors?.[0].extensions.code).toBe('NOT_FOUND');
		expect((await call(listQuery, inquiry())).data?.getHelpEntries.list).toEqual([]);
		expect(
			(await call(adminQuery, inquiry({ noticeStatus: 'HOLD' }), actors.ADMIN.token)).data?.getAllHelpEntriesByAdmin
				.list,
		).toHaveLength(1);
		expect(
			(await call(updateQuery, { input: { entryId: entry._id, noticeStatus: 'ACTIVE' } }, actors.ADMIN.token)).errors,
		).toBeUndefined();
		expect((await call(detailQuery, { entryId: entry._id })).data?.getHelpEntry.noticeStatus).toBe('ACTIVE');
		expect(
			(
				await call(
					updateQuery,
					{ input: { entryId: entry._id, noticeTitle: ' Revised booking question ' } },
					actors.ADMIN.token,
				)
			).data?.updateHelpEntry.noticeTitle,
		).toBe('Revised booking question');
		await call(updateQuery, { input: { entryId: entry._id, noticeStatus: 'HOLD' } }, actors.ADMIN.token);
		expect((await call(listQuery, inquiry())).data?.getHelpEntries.list).toEqual([]);
	});
	it('physically deletes active and draft records and rejects repeat deletion', async () => {
		for (const noticeStatus of ['HOLD', 'ACTIVE']) {
			const entry = await fixture({ noticeStatus });
			expect((await call(removeQuery, { entryId: entry._id }, actors.ADMIN.token)).errors).toBeUndefined();
			expect(await connection.collection('notices').findOne({ _id: new Types.ObjectId(entry._id) })).toBeNull();
			expect((await call(removeQuery, { entryId: entry._id }, actors.ADMIN.token)).errors?.[0].extensions.code).toBe(
				'NOT_FOUND',
			);
		}
	});
	it('orders FAQs oldest first and notices newest first with stable ties and pagination', async () => {
		const faq1 = await fixture({ noticeStatus: 'ACTIVE', noticeTitle: 'First [literal] FAQ' });
		const faq2 = await fixture({ noticeStatus: 'ACTIVE', noticeTitle: 'Second FAQ' });
		const notice1 = await fixture({
			noticeCategory: 'NOTICE',
			faqTopic: undefined,
			noticeStatus: 'ACTIVE',
			noticeTitle: 'First notice',
		});
		const notice2 = await fixture({
			noticeCategory: 'NOTICE',
			faqTopic: undefined,
			noticeStatus: 'ACTIVE',
			noticeTitle: 'Second notice',
		});
		await connection.collection('notices').updateMany({}, { $set: { createdAt: new Date('2026-01-01') } });
		const faqs = await call(listQuery, inquiry({ noticeCategory: 'FAQ' }));
		expect(faqs.data?.getHelpEntries.list.map((e) => e._id)).toEqual([faq1._id, faq2._id].sort());
		const notices = await call(listQuery, inquiry({ noticeCategory: 'NOTICE' }));
		expect(notices.data?.getHelpEntries.list.map((e) => e._id)).toEqual([notice1._id, notice2._id].sort().reverse());
		const page1 = await call(listQuery, inquiry({ noticeCategory: 'FAQ' }, 1, 1));
		const page2 = await call(listQuery, inquiry({ noticeCategory: 'FAQ' }, 2, 1));
		expect(page1.data?.getHelpEntries.metaCounter).toEqual([{ total: 2 }]);
		expect(page1.data?.getHelpEntries.list[0]._id).not.toBe(page2.data?.getHelpEntries.list[0]._id);
		expect((await call(listQuery, inquiry({ text: '[literal]' }))).data?.getHelpEntries.list).toHaveLength(1);
		expect((await call(listQuery, inquiry({ faqTopic: 'BOOKINGS' }))).data?.getHelpEntries.list).toHaveLength(2);
		expect((await call(listQuery, inquiry({ faqTopic: 'OTHER' }))).data?.getHelpEntries.metaCounter).toEqual([]);
	});
	it('keeps legacy categories and DELETE records outside public and admin Help Center lists', async () => {
		await connection.collection('notices').insertMany(
			['TERMS', 'INQUIRY', 'FAQ'].map((noticeCategory) => ({
				noticeCategory,
				noticeStatus: noticeCategory === 'FAQ' ? 'DELETE' : 'ACTIVE',
			})),
		);
		expect((await call(listQuery, inquiry())).data?.getHelpEntries.list).toEqual([]);
		expect((await call(adminQuery, inquiry(), actors.ADMIN.token)).data?.getAllHelpEntriesByAdmin.list).toEqual([]);
	});
	it('rejects anonymous, USER and AGENT administration without writes', async () => {
		const entry = await fixture();
		for (const token of [undefined, actors.USER.token, actors.AGENT.token]) {
			const expected = token ? 'FORBIDDEN' : 'UNAUTHENTICATED';
			expect((await create({}, token ?? '')).errors?.[0].extensions.code).toBe(expected);
			expect((await call(adminQuery, inquiry(), token)).errors?.[0].extensions.code).toBe(expected);
			expect(
				(await call(updateQuery, { input: { entryId: entry._id, noticeStatus: 'ACTIVE' } }, token)).errors?.[0]
					.extensions.code,
			).toBe(expected);
			expect((await call(removeQuery, { entryId: entry._id }, token)).errors?.[0].extensions.code).toBe(expected);
		}
		expect(await connection.collection('notices').countDocuments()).toBe(1);
	});
	it('rejects disabled and stale-role admin tokens, and invalid optional-auth public tokens', async () => {
		for (const memberStatus of ['BLOCK', 'SUSPENDED', 'PENDING', 'DELETE']) {
			await connection.collection('members').updateOne({ _id: actors.ADMIN.id }, { $set: { memberStatus } });
			expect((await call(adminQuery, inquiry(), actors.ADMIN.token)).errors?.[0].extensions.code).toBe(
				memberStatus === 'DELETE' ? 'UNAUTHENTICATED' : 'FORBIDDEN',
			);
		}
		await connection
			.collection('members')
			.updateOne({ _id: actors.ADMIN.id }, { $set: { memberStatus: 'ACTIVE', memberType: 'USER' } });
		expect((await create()).errors?.[0].extensions.code).toBe('UNAUTHENTICATED');
		await connection.collection('members').updateOne({ _id: actors.ADMIN.id }, { $set: { memberType: 'ADMIN' } });
		expect((await call(listQuery, inquiry(), 'invalid')).errors?.[0].extensions.code).toBe('UNAUTHENTICATED');
	});
	it('validates cross-fields, enum restrictions, lengths, nulls and spoofed owner fields', async () => {
		for (const patch of [
			{ faqTopic: null },
			{ noticeCategory: 'NOTICE', faqTopic: 'BOOKINGS' },
			{ noticeCategory: 'TERMS' },
			{ noticeStatus: 'DELETE' },
			{ noticeTitle: '  ' },
			{ noticeContent: 'x'.repeat(10001) },
			{ noticeTitle: 'x'.repeat(151) },
			{ memberId: actors.USER.id.toHexString() },
		])
			expect((await create(patch)).errors).toBeDefined();
		expect(await connection.collection('notices').countDocuments()).toBe(0);
		const entry = await fixture();
		for (const patch of [
			{},
			{ noticeTitle: null },
			{ faqTopic: null },
			{ noticeStatus: null },
			{ noticeCategory: 'NOTICE' },
			{ memberId: actors.USER.id.toHexString() },
		])
			expect(
				(await call(updateQuery, { input: { entryId: entry._id, ...patch } }, actors.ADMIN.token)).errors,
			).toBeDefined();
		const notice = await fixture({ noticeCategory: 'NOTICE', faqTopic: undefined });
		expect(
			(await call(updateQuery, { input: { entryId: notice._id, faqTopic: 'TOURS' } }, actors.ADMIN.token)).errors?.[0]
				.extensions.code,
		).toBe('BAD_REQUEST');
	});
	it('rejects malformed IDs, pagination, missing search and topic/notice combinations', async () => {
		expect((await call(detailQuery, { entryId: 'invalid' })).errors?.[0].extensions.code).toBe('BAD_REQUEST');
		for (const input of [
			{ page: 0, limit: 10, search: {} },
			{ page: 1, limit: 101, search: {} },
			{ page: 1, limit: 10 },
			{ page: 1, limit: 10, search: { noticeCategory: 'NOTICE', faqTopic: 'TOURS' } },
		])
			expect((await call(listQuery, { input })).errors).toBeDefined();
	});
});
