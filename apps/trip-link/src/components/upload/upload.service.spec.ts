import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { Types } from 'mongoose';
import { uploadRoot } from '../../libs/config';
import { MemberType } from '../../libs/enums/member.enum';
import { FileUpload, UploadService } from './upload.service';

// Only the storage location is replaced; real streams and filesystem operations are used.
jest.mock('../../libs/config', () => {
	const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
	const os = jest.requireActual<typeof import('node:os')>('node:os');
	const paths = jest.requireActual<typeof import('node:path')>('node:path');
	return {
		...jest.requireActual<typeof import('../../libs/config')>('../../libs/config'),
		uploadRoot: fs.mkdtempSync(paths.join(os.tmpdir(), 'tl-upload-unit-')),
	};
});

describe('UploadService real storage and cleanup', () => {
	const id = new Types.ObjectId().toHexString();
	const findOne = jest.fn();
	const exec = jest.fn();
	const service = new UploadService({ findOne } as unknown as ConstructorParameters<typeof UploadService>[0]);
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=',
		'base64',
	);
	beforeEach(async () => {
		jest.resetAllMocks();
		findOne.mockReturnValue({ select: () => ({ lean: () => ({ exec }) }) });
		exec.mockResolvedValue({ memberType: MemberType.AGENT, memberStatus: 'ACTIVE' });
		await clean();
		await mkdir(uploadRoot);
	});
	afterAll(clean);

	it('stores PNG bytes under a generated contained path, ignoring client path segments', async () => {
		const url = await service.uploadImage(file(png, '../../client.PNG'), 'tour', id);
		expect(url).toMatch(/^uploads\/tour\/[a-f0-9-]{36}\.png$/);
		expect(await readFile(path.join(uploadRoot, url.replace('uploads/', '')))).toEqual(png);
		expect(await readdir(path.join(uploadRoot, 'tour'))).toHaveLength(1);
	});

	it('normalizes JPEG extensions and accepts matching JPEG signatures', async () => {
		const jpegSignatureFixture = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
		const url = await service.uploadImage(file(jpegSignatureFixture, 'client.jpeg', 'image/jpeg'), 'member', id);
		expect(url).toMatch(/\.jpg$/);
		expect(await readFile(path.join(uploadRoot, url.replace('uploads/', '')))).toEqual(jpegSignatureFixture);
	});

	it('denies invalid IDs, unrecognized/traversal targets and inactive accounts before opening streams', async () => {
		const stream = jest.fn(() => Readable.from(png));
		const upload = Promise.resolve({ filename: 'a.png', mimetype: 'image/png', createReadStream: stream });
		for (const target of ['../tour', '/tour', 'unknown'])
			await expect(service.uploadImage(upload, target, id)).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.uploadImage(upload, 'tour', 'invalid')).rejects.toBeInstanceOf(BadRequestException);
		expect(findOne).not.toHaveBeenCalled();
		exec.mockResolvedValue(null);
		await expect(service.uploadImage(upload, 'member', id)).rejects.toBeInstanceOf(ForbiddenException);
		expect(stream).not.toHaveBeenCalled();
		expect(await readdir(uploadRoot)).toEqual([]);
	});

	it('allows USER member/article uploads but reserves tour uploads for AGENT and ADMIN', async () => {
		exec.mockResolvedValue({ memberType: MemberType.USER, memberStatus: 'ACTIVE' });
		await expect(service.uploadImage(file(png), 'tour', id)).rejects.toBeInstanceOf(ForbiddenException);
		for (const target of ['member', 'article'])
			await expect(service.uploadImage(file(png), target, id)).resolves.toContain(`uploads/${target}/`);
		exec.mockResolvedValue({ memberType: MemberType.ADMIN, memberStatus: 'ACTIVE' });
		await expect(service.uploadImage(file(png), 'tour', id)).resolves.toContain('uploads/tour/');
	});

	it('rejects unsupported metadata, forged signatures and truncated files without leaving files', async () => {
		for (const upload of [
			file(png, 'a.gif', 'image/gif'),
			file(png, 'a.png', 'image/jpeg'),
			file(png, 'a.jpg', 'image/jpeg'),
			file(Buffer.from('not an image')),
			file(Buffer.from([0x89, 0x50])),
		])
			await expect(service.uploadImage(upload, 'tour', id)).rejects.toBeInstanceOf(BadRequestException);
		expect(await readdir(path.join(uploadRoot, 'tour'))).toEqual([]);
	});

	it('rolls back previously stored batch images when a later image fails', async () => {
		await expect(service.uploadImages([file(png), file(Buffer.from('invalid'))], 'tour', id)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(await readdir(path.join(uploadRoot, 'tour'))).toEqual([]);
	});

	it('cleans partial stream writes and earlier batch files after a stream failure', async () => {
		const failing = Promise.resolve({
			filename: 'broken.png',
			mimetype: 'image/png',
			createReadStream: () =>
				Readable.from(
					(function* () {
						yield png;
						throw new Error('injected stream failure');
					})(),
				),
		});
		await expect(service.uploadImages([file(png), failing], 'tour', id)).rejects.toBeInstanceOf(
			InternalServerErrorException,
		);
		expect(await readdir(path.join(uploadRoot, 'tour'))).toEqual([]);
	});

	it('propagates database failures before storing files', async () => {
		const failure = new Error('database unavailable');
		exec.mockRejectedValue(failure);
		await expect(service.uploadImage(file(png), 'tour', id)).rejects.toBe(failure);
		expect(await readdir(uploadRoot)).toEqual([]);
	});

	function file(bytes: Buffer, filename = 'a.png', mimetype = 'image/png'): Promise<FileUpload> {
		return Promise.resolve({ filename, mimetype, createReadStream: () => Readable.from(bytes) });
	}
	async function clean() {
		if (path.dirname(uploadRoot) !== tmpdir() || !path.basename(uploadRoot).startsWith('tl-upload-unit-'))
			throw new Error('Unsafe upload cleanup');
		await rm(uploadRoot, { recursive: true, force: true });
	}
});
