import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BoardArticleCategory, BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { Direction } from '../../libs/enums/common.enum';
import { BoardArticleService } from './board-article.service';

describe('BoardArticleService query and access boundaries', () => {
	const authorId = new Types.ObjectId().toHexString();
	const articleId = new Types.ObjectId().toHexString();
	const aggregate = jest.fn();
	const exec = jest.fn();
	const update = jest.fn();
	const model = { aggregate, findOneAndUpdate: update };
	const service = new BoardArticleService(
		model as unknown as ConstructorParameters<typeof BoardArticleService>[0],
		{} as ConstructorParameters<typeof BoardArticleService>[1],
		{} as ConstructorParameters<typeof BoardArticleService>[2],
		{} as ConstructorParameters<typeof BoardArticleService>[3],
		{} as ConstructorParameters<typeof BoardArticleService>[4],
	);
	beforeEach(() => {
		jest.clearAllMocks();
		aggregate.mockReturnValue({ exec });
		update.mockReturnValue({ exec });
		exec.mockResolvedValue([{ list: [], metaCounter: [] }]);
	});

	it('uses active-only escaped title search, author filtering and stable sort', async () => {
		await service.getBoardArticles({
			page: 2,
			limit: 5,
			sort: 'articleLikes',
			direction: Direction.ASC,
			search: { text: 'Trip.*[x]', memberId: authorId, articleCategory: BoardArticleCategory.NEWS },
		});
		expect(aggregate).toHaveBeenCalledWith(
			expect.arrayContaining([
				{
					$match: {
						articleStatus: BoardArticleStatus.ACTIVE,
						memberId: new Types.ObjectId(authorId),
						articleCategory: BoardArticleCategory.NEWS,
						articleTitle: { $regex: 'Trip\\.\\*\\[x\\]', $options: 'i' },
					},
				},
				{ $sort: { articleLikes: 1, _id: 1 } },
			]),
		);
	});

	it('uses an author allowlist excluding credentials and contact information', async () => {
		await service.getBoardArticle(articleId);
		const calls = aggregate.mock.calls as unknown[][];
		const pipeline: unknown = calls[0][0];
		const serialized = JSON.stringify(pipeline);
		for (const field of ['memberPassword', 'memberEmail', 'memberPhone', 'memberAddress', 'lastLoginAt'])
			expect(serialized).not.toContain(field);
		expect(serialized).toContain('memberNick');
		expect(serialized).toContain('"meLiked":false');
	});

	it('allows admin status filtering without forcing active status', async () => {
		await service.getAllBoardArticlesByAdmin({
			page: 1,
			limit: 10,
			search: { articleStatus: BoardArticleStatus.DELETE },
		});
		expect(aggregate).toHaveBeenCalledWith(
			expect.arrayContaining([{ $match: { articleStatus: BoardArticleStatus.DELETE } }]),
		);
	});

	it('conditions owner edits on both ownership and active status', async () => {
		exec.mockResolvedValue(null);
		await expect(
			service.updateBoardArticle({ _id: articleId, articleStatus: BoardArticleStatus.DELETE }, authorId),
		).rejects.toBeInstanceOf(NotFoundException);
		expect(update).toHaveBeenCalledWith(
			{
				_id: new Types.ObjectId(articleId),
				memberId: new Types.ObjectId(authorId),
				articleStatus: BoardArticleStatus.ACTIVE,
			},
			{ $set: { articleStatus: BoardArticleStatus.DELETE } },
			{ new: true, runValidators: true },
		);
	});

	it('rejects malformed IDs, empty edits, whitespace and unsafe image paths before writes', async () => {
		await expect(service.getBoardArticle('bad')).rejects.toBeInstanceOf(BadRequestException);
		for (const patch of [
			{},
			{ articleTitle: '  ' },
			{ articleContent: 'x'.repeat(2001) },
			{ articleImage: 'uploads/article/../secret.png' },
		]) {
			await expect(service.updateBoardArticle({ _id: articleId, ...patch }, authorId)).rejects.toBeInstanceOf(
				BadRequestException,
			);
		}
		expect(update).not.toHaveBeenCalled();
	});

	it('propagates database failures without reporting them as missing or unauthorized', async () => {
		const error = new Error('database offline');
		exec.mockRejectedValue(error);
		await expect(service.getBoardArticle(articleId)).rejects.toBe(error);
	});
});
