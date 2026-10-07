import {
	BadRequestException,
	ConflictException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { BoardArticle, BoardArticles } from '../../libs/dto/board-article/board-article';
import {
	AllBoardArticlesInquiry,
	articleImagePattern,
	BoardArticleInput,
	BoardArticlesInquiry,
} from '../../libs/dto/board-article/board-article.input';
import { BoardArticleUpdate } from '../../libs/dto/board-article/board-article.update';
import { BoardArticleCategory, BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { LikeGroup } from '../../libs/enums/like.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { LikeService } from '../like/like.service';
import { ViewService } from '../view/view.service';

type Relation = {
	memberId: Types.ObjectId;
	likeRefId?: Types.ObjectId;
	viewRefId?: Types.ObjectId;
	likeGroup?: LikeGroup;
	viewGroup?: ViewGroup;
};

@Injectable()
export class BoardArticleService {
	constructor(
		@InjectModel('BoardArticle') private readonly articles: Model<BoardArticle>,
		@InjectModel('Like') private readonly likes: Model<Relation>,
		@InjectModel('View') private readonly views: Model<Relation>,
		private readonly likeService: LikeService,
		private readonly viewService: ViewService,
	) {}

	public async createBoardArticle(memberId: string, input: BoardArticleInput): Promise<BoardArticle> {
		const author = this.objectId(memberId);
		const fields = this.editableFields(input);
		if (!fields.articleTitle || !fields.articleContent || !fields.articleCategory)
			throw new BadRequestException(Message.BAD_REQUEST);
		const article = await this.articles.create({
			...fields,
			memberId: author,
			articleStatus: BoardArticleStatus.ACTIVE,
		});
		return this.load({ _id: article._id }, memberId);
	}

	public async getBoardArticle(articleId: string, memberId?: string): Promise<BoardArticle> {
		const _id = this.objectId(articleId);
		if (!memberId) return this.load({ _id, articleStatus: BoardArticleStatus.ACTIVE });
		this.objectId(memberId);
		return this.transaction(async (session) => {
			await this.load({ _id, articleStatus: BoardArticleStatus.ACTIVE }, memberId, session);
			await this.viewService.recordView({ memberId, viewRefId: articleId, viewGroup: ViewGroup.ARTICLE }, session);
			const articleViews = await this.viewService.countTargetViews(articleId, ViewGroup.ARTICLE, session);
			await this.writeStats(_id, { articleViews }, session);
			return this.load({ _id, articleStatus: BoardArticleStatus.ACTIVE }, memberId, session);
		});
	}

	public getBoardArticles(input: BoardArticlesInquiry, memberId?: string): Promise<BoardArticles> {
		return this.list(input, memberId, false);
	}

	public getAllBoardArticlesByAdmin(input: AllBoardArticlesInquiry, memberId?: string): Promise<BoardArticles> {
		return this.list(input, memberId, true);
	}

	public async updateBoardArticle(input: BoardArticleUpdate, memberId: string, admin = false): Promise<BoardArticle> {
		const _id = this.objectId(input._id);
		const author = this.objectId(memberId);
		const fields = this.editableFields(input);
		if (input.articleStatus !== undefined) {
			if (!Object.values(BoardArticleStatus).includes(input.articleStatus))
				throw new BadRequestException(Message.BAD_REQUEST);
			fields.articleStatus = input.articleStatus;
		}
		if (!Object.keys(fields).length) throw new BadRequestException(Message.NO_UPDATE_FIELDS);
		const match = { _id, articleStatus: BoardArticleStatus.ACTIVE, ...(!admin ? { memberId: author } : {}) };
		const updated = await this.articles
			.findOneAndUpdate(match, { $set: fields }, { new: true, runValidators: true })
			.exec();
		if (!updated) throw new NotFoundException(Message.NO_DATA_FOUND);
		return this.load({ _id }, memberId);
	}

	public async likeTargetBoardArticle(articleId: string, memberId: string): Promise<BoardArticle> {
		const _id = this.objectId(articleId);
		this.objectId(memberId);
		return this.transaction(async (session) => {
			await this.load({ _id, articleStatus: BoardArticleStatus.ACTIVE }, memberId, session);
			await this.likeService.toggleLike({ memberId, likeRefId: articleId, likeGroup: LikeGroup.ARTICLE }, session);
			const articleLikes = await this.likeService.countTargetLikes(
				{ likeRefId: articleId, likeGroup: LikeGroup.ARTICLE },
				session,
			);
			await this.writeStats(_id, { articleLikes }, session);
			return this.load({ _id, articleStatus: BoardArticleStatus.ACTIVE }, memberId, session);
		});
	}

	public async removeBoardArticleByAdmin(articleId: string): Promise<BoardArticle> {
		const _id = this.objectId(articleId);
		return this.transaction(async (session) => {
			const article = await this.load({ _id }, undefined, session);
			if (article.articleStatus !== BoardArticleStatus.DELETE) throw new ConflictException(Message.NOT_ALLOWED_REQUEST);
			const removed = await this.articles
				.findOneAndDelete({ _id, articleStatus: BoardArticleStatus.DELETE })
				.session(session)
				.exec();
			if (!removed) throw new ConflictException(Message.REMOVE_FAILED);
			await this.likes.deleteMany({ likeRefId: _id, likeGroup: LikeGroup.ARTICLE }).session(session).exec();
			await this.views.deleteMany({ viewRefId: _id, viewGroup: ViewGroup.ARTICLE }).session(session).exec();
			return article;
		});
	}

	private async writeStats(
		_id: Types.ObjectId,
		fields: { articleLikes?: number; articleViews?: number },
		session: ClientSession,
	): Promise<void> {
		const updated = await this.articles
			.findOneAndUpdate(
				{ _id, articleStatus: BoardArticleStatus.ACTIVE },
				{ $set: fields },
				{ new: true, session, timestamps: false, runValidators: true },
			)
			.exec();
		if (!updated) throw new ConflictException(Message.UPDATE_FAILED);
	}

	private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
		// Existing unique relationship indexes can produce E11000 during concurrent first interactions.
		for (let attempt = 0; attempt < 4; attempt++) {
			const session = await this.articles.db.startSession();
			try {
				const result = await session.withTransaction(() => work(session));
				if (result === undefined) throw new InternalServerErrorException(Message.UPDATE_FAILED);
				return result;
			} catch (error: unknown) {
				if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)) throw error;
				if (attempt === 3) throw new ConflictException(Message.UPDATE_FAILED);
			} finally {
				await session.endSession();
			}
		}
		throw new InternalServerErrorException(Message.UPDATE_FAILED);
	}

	private async load(
		match: Record<string, unknown>,
		memberId?: string,
		session?: ClientSession,
	): Promise<BoardArticle> {
		const query = this.articles.aggregate<BoardArticle>([{ $match: match }, ...this.contextStages(memberId)]);
		if (session) query.session(session);
		const [article] = await query.exec();
		if (!article) throw new NotFoundException(Message.NO_DATA_FOUND);
		return article;
	}

	private async list(
		input: BoardArticlesInquiry | AllBoardArticlesInquiry,
		memberId: string | undefined,
		admin: boolean,
	): Promise<BoardArticles> {
		const { articleCategory, text, memberId: authorId } = input.search;
		const match: Record<string, unknown> = admin ? {} : { articleStatus: BoardArticleStatus.ACTIVE };
		if (admin && 'articleStatus' in input.search && input.search.articleStatus)
			match.articleStatus = input.search.articleStatus;
		if (articleCategory) match.articleCategory = articleCategory;
		if (authorId) match.memberId = this.objectId(authorId);
		if (text) match.articleTitle = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
		const direction = input.direction ?? Direction.DESC;
		const [result] = await this.articles
			.aggregate<BoardArticles>([
				{ $match: match },
				{ $sort: { [input.sort ?? 'createdAt']: direction, _id: direction } },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, ...this.contextStages(memberId)],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		return result ?? { list: [], metaCounter: [] };
	}

	private contextStages(
		memberId?: string,
	): Array<PipelineStage.Lookup | PipelineStage.Unwind | PipelineStage.Set | PipelineStage.Unset> {
		const authorFields = [
			'memberType',
			'memberStatus',
			'memberNick',
			'memberFullname',
			'memberImage',
			'memberCountry',
			'memberDesc',
			'memberFavoriteDestinations',
			'memberTours',
			'memberReviews',
			'memberFollowers',
			'memberFollowings',
			'memberLikes',
			'memberViews',
			'memberComments',
			'createdAt',
			'updatedAt',
		];
		const stages: Array<PipelineStage.Lookup | PipelineStage.Unwind> = [
			{
				$lookup: {
					from: 'members',
					localField: 'memberId',
					foreignField: '_id',
					pipeline: [{ $project: Object.fromEntries(authorFields.map((key) => [key, 1])) }],
					as: 'memberData',
				},
			},
			{ $unwind: { path: '$memberData', preserveNullAndEmptyArrays: true } },
		];
		if (!memberId) return [...stages, { $set: { meLiked: false } }];
		return [
			...stages,
			{
				$lookup: {
					from: 'likes',
					let: { articleId: '$_id' },
					pipeline: [
						{
							$match: {
								likeGroup: LikeGroup.ARTICLE,
								memberId: this.objectId(memberId),
								$expr: { $eq: ['$likeRefId', '$$articleId'] },
							},
						},
						{ $limit: 1 },
					],
					as: 'viewerLikes',
				},
			},
			{ $set: { meLiked: { $gt: [{ $size: '$viewerLikes' }, 0] } } },
			{ $unset: 'viewerLikes' },
		];
	}

	private objectId(value: string): Types.ObjectId {
		if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value))
			throw new BadRequestException(Message.BAD_REQUEST);
		return new Types.ObjectId(value);
	}

	private editableFields(input: BoardArticleInput | BoardArticleUpdate): Record<string, string> {
		const fields: Record<string, string> = {};
		if (input.articleCategory !== undefined) {
			if (!Object.values(BoardArticleCategory).includes(input.articleCategory))
				throw new BadRequestException(Message.BAD_REQUEST);
			fields.articleCategory = input.articleCategory;
		}
		for (const [key, maximum] of [
			['articleTitle', 50],
			['articleContent', 2000],
		] as const) {
			const value = input[key];
			if (value === undefined) continue;
			if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > maximum)
				throw new BadRequestException(Message.BAD_REQUEST);
			fields[key] = value.trim();
		}
		if (input.articleImage !== undefined) {
			if (typeof input.articleImage !== 'string' || !articleImagePattern.test(input.articleImage.trim()))
				throw new BadRequestException(Message.BAD_REQUEST);
			fields.articleImage = input.articleImage.trim();
		}
		return fields;
	}
}
