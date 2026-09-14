import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';
import { isValidObjectId, Model } from 'mongoose';
import {
	getSerialForImage,
	isUploadTarget,
	type ImageExtension,
	type UploadTarget,
	uploadRoot,
} from '../../libs/config';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';

export interface FileUpload {
	createReadStream: () => Readable;
	filename: string;
	mimetype: string;
}

type UploadMember = {
	memberType: MemberType;
	memberStatus: MemberStatus;
};

type StoredImage = {
	absolutePath: string;
	url: string;
};

@Injectable()
export class UploadService {
	constructor(@InjectModel('Member') private readonly memberModel: Model<UploadMember>) {}

	public async uploadImage(file: Promise<FileUpload>, target: string, memberId: string): Promise<string> {
		const uploadTarget = await this.authorizeUpload(memberId, target);
		return (await this.storeImage(file, uploadTarget)).url;
	}

	public async uploadImages(files: Promise<FileUpload>[], target: string, memberId: string): Promise<string[]> {
		const uploadTarget = await this.authorizeUpload(memberId, target);
		const storedImages: StoredImage[] = [];

		try {
			for (const file of files) {
				storedImages.push(await this.storeImage(file, uploadTarget));
			}
		} catch (error: unknown) {
			await Promise.allSettled(storedImages.map((image) => unlink(image.absolutePath)));
			throw error;
		}

		return storedImages.map((image) => image.url);
	}

	private async authorizeUpload(memberId: string, target: string): Promise<UploadTarget> {
		if (!isValidObjectId(memberId) || !isUploadTarget(target)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberModel
			.findOne({ _id: memberId, memberStatus: MemberStatus.ACTIVE })
			.select('memberType memberStatus')
			.lean()
			.exec();

		if (!member) throw new ForbiddenException(Message.ACCOUNT_UNAVAILABLE);
		if (target === 'tour' && ![MemberType.AGENT, MemberType.ADMIN].includes(member.memberType)) {
			throw new ForbiddenException(Message.ONLY_SPECIFIC_ROLES_ALLOWED);
		}

		return target;
	}

	private async storeImage(file: Promise<FileUpload>, target: UploadTarget): Promise<StoredImage> {
		const { createReadStream, filename, mimetype } = await file;
		const expectedExtension = this.validateMetadata(filename, mimetype);
		const targetDirectory = path.resolve(uploadRoot, target);
		this.assertContainedPath(targetDirectory);
		await mkdir(targetDirectory, { recursive: true });

		const temporaryPath = path.join(targetDirectory, `.upload-${randomUUID()}.tmp`);
		let finalPath: string | undefined;
		let finalFileCreated = false;

		try {
			await pipeline(createReadStream(), createWriteStream(temporaryPath, { flags: 'wx' }));
			const detectedExtension = await this.detectImageExtension(temporaryPath);
			if (detectedExtension !== expectedExtension) {
				throw new BadRequestException(Message.PROVIDE_ALLOWED_FORMAT);
			}

			const imageName = getSerialForImage(detectedExtension);
			finalPath = path.join(targetDirectory, imageName);
			await link(temporaryPath, finalPath);
			finalFileCreated = true;
			await unlink(temporaryPath);

			return {
				absolutePath: finalPath,
				url: path.posix.join('uploads', target, imageName),
			};
		} catch (error: unknown) {
			await unlink(temporaryPath).catch(() => undefined);
			if (finalFileCreated && finalPath) await unlink(finalPath).catch(() => undefined);

			if (error instanceof BadRequestException) throw error;
			throw new InternalServerErrorException(Message.UPLOAD_FAILED);
		}
	}

	private validateMetadata(filename: string, mimetype: string): ImageExtension {
		const extension = path.extname(filename).toLowerCase();
		const normalizedMime = mimetype.toLowerCase().split(';', 1)[0];

		if (normalizedMime === 'image/png' && extension === '.png') return '.png';
		if (['image/jpeg', 'image/jpg'].includes(normalizedMime) && ['.jpg', '.jpeg'].includes(extension)) return '.jpg';

		throw new BadRequestException(Message.PROVIDE_ALLOWED_FORMAT);
	}

	private async detectImageExtension(filePath: string): Promise<ImageExtension> {
		const signature = Buffer.alloc(8);
		const fileHandle = await open(filePath, 'r');

		try {
			const { bytesRead } = await fileHandle.read(signature, 0, signature.length, 0);
			if (bytesRead >= 8 && signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
				return '.png';
			}
			if (bytesRead >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff) {
				return '.jpg';
			}
		} finally {
			await fileHandle.close();
		}

		throw new BadRequestException(Message.PROVIDE_ALLOWED_FORMAT);
	}

	private assertContainedPath(targetDirectory: string): void {
		const relativePath = path.relative(uploadRoot, targetDirectory);
		if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
	}
}
