import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CommentService } from './comment.service';

describe('Article comment validation before database writes', () => {
	const startSession = jest.fn();
	const service = new CommentService(
		{ db: { startSession } } as unknown as ConstructorParameters<typeof CommentService>[0],
		{} as ConstructorParameters<typeof CommentService>[1],
	);
	const id = new Types.ObjectId().toHexString();
	beforeEach(() => jest.clearAllMocks());
	it('rejects invalid IDs and empty/oversized content before opening a transaction', async () => {
		for (const input of [
			{ commentRefId: 'bad', commentContent: 'Hi' },
			{ commentRefId: id, commentContent: '   ' },
			{ commentRefId: id, commentContent: 'x'.repeat(101) },
		])
			await expect(service.createComment(id, input)).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.createComment('bad', { commentRefId: id, commentContent: 'Hi' })).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(startSession).not.toHaveBeenCalled();
	});
	it('rejects empty patches, restoration and admin text edits', async () => {
		await expect(service.updateComment(id, { _id: id })).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.updateComment(id, { _id: id, commentStatus: 'ACTIVE' as never })).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(service.updateComment(id, { _id: id, commentContent: 'Edited' }, true)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(startSession).not.toHaveBeenCalled();
	});
	it('closes its session and propagates transaction failures', async () => {
		const error = new Error('database offline');
		const endSession = jest.fn();
		startSession.mockResolvedValue({ withTransaction: jest.fn().mockRejectedValue(error), endSession });
		await expect(service.createComment(id, { commentRefId: id, commentContent: 'Hi' })).rejects.toBe(error);
		expect(endSession).toHaveBeenCalledTimes(1);
	});
});
