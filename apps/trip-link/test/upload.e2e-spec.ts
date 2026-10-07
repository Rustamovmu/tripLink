import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as express from 'express';
import type { RequestHandler } from 'express';
import * as graphqlUploadPackage from 'graphql-upload';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/components/auth/auth.service';
import { uploadRoot } from '../src/libs/config';
import { MemberType } from '../src/libs/enums/member.enum';

// All application modules see this isolated storage root; development uploads are never touched.
jest.mock('../src/libs/config', () => {
	const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
	const os = jest.requireActual<typeof import('node:os')>('node:os');
	const paths = jest.requireActual<typeof import('node:path')>('node:path');
	return {
		...jest.requireActual<typeof import('../src/libs/config')>('../src/libs/config'),
		uploadRoot: fs.mkdtempSync(paths.join(os.tmpdir(), 'tl-upload-e2e-')),
	};
});

type Actor = { id: Types.ObjectId; token: string };
type Image = { bytes: Buffer; filename: string; mimetype: string };
type Body = {
	data?: { imageUploader?: string; imagesUploader?: string[] } | null;
	errors?: Array<{ extensions?: { code?: string } }>;
};
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=',
	'base64',
);
const image: Image = { bytes: png, filename: 'fixture.png', mimetype: 'image/png' };
const graphqlUploadExpress = (
	graphqlUploadPackage as unknown as {
		graphqlUploadExpress: (options: { maxFileSize: number; maxFiles: number }) => RequestHandler;
	}
).graphqlUploadExpress;
jest.setTimeout(45000);

describe('Image uploads (real multipart GraphQL and static HTTP e2e)', () => {
	let app: INestApplication | undefined;
	let connection: Connection | undefined;
	let originalMongo: string | undefined;
	let database: string;
	let user: Actor;
	let agent: Actor;
	let admin: Actor;

	beforeAll(async () => {
		if (process.env.NODE_ENV === 'production') throw new Error('Upload tests cannot run in production');
		originalMongo = process.env.MONGO_DEV;
		if (!originalMongo) throw new Error('MONGO_DEV is required');
		database = `tl_up_e2e_${new Types.ObjectId().toHexString()}`;
		const url = new URL(originalMongo);
		url.pathname = `/${database}`;
		process.env.MONGO_DEV = url.toString();
		const module = await Test.createTestingModule({ imports: [AppModule] })
			.setLogger({ log: () => undefined, error: () => undefined, warn: () => undefined })
			.compile();
		app = module.createNestApplication();
		connection = app.get<Connection>(getConnectionToken());
		if (connection.name !== database) throw new Error('Unexpected upload database');
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
		// Mirror main.ts middleware and limits; this suite does not execute bootstrap itself.
		app.use('/graphql', graphqlUploadExpress({ maxFileSize: 15000000, maxFiles: 10 }));
		app.use(
			'/uploads',
			express.static(uploadRoot, {
				dotfiles: 'deny',
				index: false,
				setHeaders: (response) => {
					response.setHeader('X-Content-Type-Options', 'nosniff');
					response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
				},
			}),
		);
		await app.init();
		user = await actor(MemberType.USER);
		agent = await actor(MemberType.AGENT);
		admin = await actor(MemberType.ADMIN);
	});
	beforeEach(async () => {
		await clean();
		await mkdir(uploadRoot);
	});
	afterAll(async () => {
		try {
			if (connection && connection.name === database && /^tl_up_e2e_[a-f0-9]{24}$/.test(database))
				await connection.dropDatabase();
		} finally {
			try {
				if (app) await app.close();
			} finally {
				if (originalMongo === undefined) delete process.env.MONGO_DEV;
				else process.env.MONGO_DEV = originalMongo;
				await clean();
			}
		}
	});

	it('uploads a real PNG and serves identical bytes with security headers', async () => {
		const res = await upload([image], 'member', user.token);
		expect(res.status).toBe(200);
		const body = res.body as Body;
		expect(body.errors).toBeUndefined();
		const url = body.data!.imageUploader!;
		expect(url).toMatch(/^uploads\/member\/[a-f0-9-]{36}\.png$/);
		expect(await readFile(storedPath(url))).toEqual(png);
		const fetched = await request(app!.getHttpServer()).get(`/${url}`);
		expect(fetched.status).toBe(200);
		expect(fetched.body).toEqual(png);
		expect(fetched.headers['content-type']).toContain('image/png');
		expect(fetched.headers['x-content-type-options']).toBe('nosniff');
		expect(fetched.headers['cross-origin-resource-policy']).toBe('cross-origin');
	});

	it('permits USER member/article uploads and AGENT/ADMIN tour uploads without member changes', async () => {
		const before = await memberSnapshot();
		for (const [target, token] of [
			['article', user.token],
			['tour', agent.token],
			['tour', admin.token],
		]) {
			const res = await upload([image], target, token);
			expect((res.body as Body).errors).toBeUndefined();
			expect((res.body as Body).data?.imageUploader).toContain(`uploads/${target}/`);
		}
		expect(await memberSnapshot()).toEqual(before);
	});

	it('rejects anonymous/invalid tokens, forbidden roles and traversal targets without storing files', async () => {
		const before = await memberSnapshot();
		for (const [target, token, code] of [
			['member', '', 'UNAUTHENTICATED'],
			['member', 'invalid-token', 'UNAUTHENTICATED'],
			['tour', user.token, 'FORBIDDEN'],
			['../tour', agent.token, 'BAD_REQUEST'],
			['unknown', admin.token, 'BAD_REQUEST'],
		]) {
			const res = await upload([image], target, token);
			expect((res.body as Body).errors?.[0].extensions?.code).toBe(code);
		}
		expect(await readdir(uploadRoot)).toEqual([]);
		expect(await memberSnapshot()).toEqual(before);
	});

	it('rejects disabled and outdated-role tokens using real current-account checks', async () => {
		const disabled = await actor(MemberType.AGENT);
		for (const status of ['PENDING', 'BLOCK', 'SUSPENDED', 'DELETE']) {
			await db()
				.collection('members')
				.updateOne({ _id: disabled.id }, { $set: { memberStatus: status } });
			const before = await memberSnapshot();
			expect(((await upload([image], 'tour', disabled.token)).body as Body).errors).toBeDefined();
			expect(await memberSnapshot()).toEqual(before);
		}
		await db()
			.collection('members')
			.updateOne({ _id: disabled.id }, { $set: { memberStatus: 'ACTIVE', memberType: 'ADMIN' } });
		expect(((await upload([image], 'tour', disabled.token)).body as Body).errors?.[0].extensions?.code).toBe(
			'UNAUTHENTICATED',
		);
		expect(await readdir(uploadRoot)).toEqual([]);
	});

	it('rejects MIME mismatches, forged file contents and unsupported formats with no leftover files', async () => {
		for (const invalid of [
			{ ...image, mimetype: 'image/jpeg' },
			{ ...image, filename: 'a.jpg', mimetype: 'image/jpeg' },
			{ ...image, bytes: Buffer.from('not a PNG') },
			{ ...image, filename: 'a.gif', mimetype: 'image/gif' },
		]) {
			const res = await upload([invalid], 'member', user.token);
			expect((res.body as Body).errors?.[0].extensions?.code).toBe('BAD_REQUEST');
		}
		expect(await readdir(path.join(uploadRoot, 'member'))).toEqual([]);
	});

	it('returns distinct generated paths in batch order and removes the whole batch after a later failure', async () => {
		const res = await upload([image, { ...image, filename: 'second.png' }], 'tour', agent.token, true);
		const urls = (res.body as Body).data?.imagesUploader;
		expect((res.body as Body).errors).toBeUndefined();
		expect(urls).toHaveLength(2);
		expect(new Set(urls).size).toBe(2);
		for (const url of urls!) expect(await readFile(storedPath(url))).toEqual(png);
		const before = await readdir(path.join(uploadRoot, 'tour'));
		const rejected = await upload([image, { ...image, bytes: Buffer.from('invalid') }], 'tour', agent.token, true);
		expect((rejected.body as Body).errors?.[0].extensions?.code).toBe('BAD_REQUEST');
		expect(await readdir(path.join(uploadRoot, 'tour'))).toEqual(before);
	});

	it('enforces the 15,000,000-byte upload limit and cleans truncated temporary files', async () => {
		const bytes = Buffer.alloc(15000001);
		png.copy(bytes);
		const res = await upload([{ ...image, bytes }], 'tour', agent.token);
		expect((res.body as Body).errors).toBeDefined();
		expect((res.body as Body).data?.imageUploader).toBeFalsy();
		expect(await readdir(path.join(uploadRoot, 'tour'))).toEqual([]);
	});

	it('rejects more than ten attached files at the multipart middleware', async () => {
		const res = await upload(
			Array.from({ length: 11 }, () => image),
			'member',
			user.token,
			true,
		);
		expect(res.status).toBe(413);
		expect(await readdir(uploadRoot)).toEqual([]);
	});

	it('requires the Apollo preflight header for multipart requests', async () => {
		const res = await upload([image], 'member', user.token, false, false);
		expect(res.status).toBe(400);
		expect((res.body as Body).errors).toBeDefined();
		expect(await readdir(uploadRoot)).toEqual([]);
	});

	it('rejects malformed multipart maps before invoking upload storage', async () => {
		const res = await request(app!.getHttpServer())
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true')
			.set('Authorization', `Bearer ${user.token}`)
			.field(
				'operations',
				JSON.stringify({
					query: 'mutation($file: Upload!) { imageUploader(file: $file, target: "member") }',
					variables: { file: null },
				}),
			)
			.field('map', 'not-json')
			.attach('0', png, { filename: 'a.png', contentType: 'image/png' });
		expect(res.status).toBe(400);
		expect(await readdir(uploadRoot)).toEqual([]);
	});

	it('does not expose temporary dotfiles or directory indexes through static serving', async () => {
		await mkdir(path.join(uploadRoot, 'member'));
		await writeFile(path.join(uploadRoot, 'member', '.upload-disposable.tmp'), png);
		for (const url of ['/uploads/member/.upload-disposable.tmp', '/uploads/member/'])
			expect((await request(app!.getHttpServer()).get(url)).status).toBe(404);
	});

	function db(): Connection {
		if (!connection || connection.name !== database || !/^tl_up_e2e_[a-f0-9]{24}$/.test(database))
			throw new Error('Unsafe upload database');
		return connection;
	}
	async function actor(role: MemberType): Promise<Actor> {
		const id = new Types.ObjectId();
		const nick = `upload-${id.toHexString()}`;
		const members = app!.get<Model<unknown>>(getModelToken('Member'));
		await members.create({
			_id: id,
			memberNick: nick,
			memberType: role,
			memberStatus: 'ACTIVE',
			memberPassword: 'disposable-test-hash',
			memberEmail: `${nick}@example.invalid`,
			memberPhone: id.toHexString(),
		});
		return {
			id,
			token: await app!.get<AuthService>(AuthService).createToken({ _id: id, memberNick: nick, memberType: role }),
		};
	}
	function upload(images: Image[], target: string, token: string, batch = false, preflight = true) {
		const query = batch
			? 'mutation($files: [Upload!]!, $target: String!) { imagesUploader(files: $files, target: $target) }'
			: 'mutation($file: Upload!, $target: String!) { imageUploader(file: $file, target: $target) }';
		const variables = batch ? { files: images.map(() => null), target } : { file: null, target };
		const map = Object.fromEntries(
			images.map((_img, index) => [String(index), [batch ? `variables.files.${index}` : 'variables.file']]),
		);
		let req = request(app!.getHttpServer()).post('/graphql');
		if (token) req = req.set('Authorization', `Bearer ${token}`);
		if (preflight) req = req.set('Apollo-Require-Preflight', 'true');
		req = req.field('operations', JSON.stringify({ query, variables })).field('map', JSON.stringify(map));
		images.forEach((img, index) => {
			req = req.attach(String(index), img.bytes, { filename: img.filename, contentType: img.mimetype });
		});
		return req;
	}
	function storedPath(url: string) {
		if (!/^uploads\/(member|tour|article)\/[a-f0-9-]{36}\.(png|jpg)$/.test(url))
			throw new Error('Unexpected uploaded path');
		return path.join(uploadRoot, url.replace('uploads/', ''));
	}
	function memberSnapshot() {
		return db().collection('members').find().sort({ _id: 1 }).toArray();
	}
	async function clean() {
		if (path.dirname(uploadRoot) !== tmpdir() || !path.basename(uploadRoot).startsWith('tl-upload-e2e-'))
			throw new Error('Unsafe upload cleanup');
		await rm(uploadRoot, { recursive: true, force: true });
	}
});
