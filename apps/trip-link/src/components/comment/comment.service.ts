import {
	BadRequestException,
	ConflictException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { BoardArticle } from '../../libs/dto/board-article/board-article';
import { Comment, Comments } from '../../libs/dto/comment/comment';
import { AllCommentsInquiry, CommentInput, CommentsInquiry, commentSorts } from '../../libs/dto/comment/comment.input';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { CommentGroup, CommentStatus } from '../../libs/enums/comment.enum';
import { Direction, Message } from '../../libs/enums/common.enum';

@Injectable()
export class CommentService {
	constructor(
		@InjectModel('Comment') private readonly comments: Model<Comment>,
		@InjectModel('BoardArticle') private readonly articles: Model<BoardArticle>,
	) {}

	async createComment(memberId: string, input: CommentInput): Promise<Comment> {
		const author = this.objectId(memberId);
		const ref = this.objectId(input.commentRefId);
		const content = this.content(input.commentContent);
		return this.transaction(async (session) => {
			await this.requireArticle(ref, session, true);
			const [comment] = await this.comments.create(
				[
					{
						memberId: author,
						commentRefId: ref,
						commentGroup: CommentGroup.ARTICLE,
						commentStatus: CommentStatus.ACTIVE,
						commentContent: content,
					},
				],
				{ session },
			);
			await this.syncCount(ref, session, true);
			return this.load(comment._id, session);
		});
	}

	async updateComment(memberId: string, input: CommentUpdate, admin = false): Promise<Comment> {
		const id = this.objectId(input._id);
		const author = this.objectId(memberId);
		const fields: { commentContent?: string; commentStatus?: CommentStatus } = {};
		if (input.commentContent !== undefined) fields.commentContent = this.content(input.commentContent);
		if (input.commentStatus !== undefined) {
			if (input.commentStatus !== CommentStatus.DELETE) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
			fields.commentStatus = CommentStatus.DELETE;
		}
		if (!Object.keys(fields).length) throw new BadRequestException(Message.NO_UPDATE_FIELDS);
		if (admin && (fields.commentStatus !== CommentStatus.DELETE || fields.commentContent !== undefined))
			throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		return this.transaction(async (session) => {
			const match = {
				_id: id,
				commentGroup: CommentGroup.ARTICLE,
				commentStatus: CommentStatus.ACTIVE,
				...(!admin ? { memberId: author } : {}),
			};
			const comment = await this.comments.findOne(match).session(session).exec();
			if (!comment) throw new NotFoundException(Message.NO_DATA_FOUND);
			// Owners can remove their comments even after an article is hidden; text edits require an active article.
			const activeOnly = fields.commentStatus !== CommentStatus.DELETE;
			await this.requireArticle(comment.commentRefId, session, activeOnly);
			const updated = await this.comments
				.findOneAndUpdate(match, { $set: fields }, { new: true, runValidators: true, session })
				.exec();
			if (!updated) throw new ConflictException(Message.UPDATE_FAILED);
			await this.syncCount(comment.commentRefId, session, activeOnly);
			return this.load(id, session);
		});
	}

	async removeCommentByAdmin(commentId: string): Promise<Comment> {
		const id = this.objectId(commentId);
		return this.transaction(async (session) => {
			const comment = await this.load(id, session);
			if (comment.commentStatus !== CommentStatus.DELETE) throw new ConflictException(Message.NOT_ALLOWED_REQUEST);
			await this.requireArticle(comment.commentRefId, session, false);
			const removed = await this.comments
				.findOneAndDelete({ _id: id, commentGroup: CommentGroup.ARTICLE, commentStatus: CommentStatus.DELETE })
				.session(session)
				.exec();
			if (!removed) throw new ConflictException(Message.REMOVE_FAILED);
			await this.syncCount(comment.commentRefId, session, false);
			return comment;
		});
	}

	async getComments(input: CommentsInquiry | AllCommentsInquiry, admin = false): Promise<Comments> {
		const ref = this.objectId(input.search.commentRefId);
		const sort = input.sort ?? 'createdAt';
		const direction = input.direction ?? Direction.DESC;
		if (
			!Number.isInteger(input.page) ||
			input.page < 1 ||
			!Number.isInteger(input.limit) ||
			input.limit < 1 ||
			input.limit > 100 ||
			!commentSorts.includes(sort) ||
			![Direction.ASC, Direction.DESC].includes(direction)
		)
			throw new BadRequestException(Message.BAD_REQUEST);
		const status = admin && 'commentStatus' in input.search ? input.search.commentStatus : undefined;
		if (status !== undefined && !Object.values(CommentStatus).includes(status))
			throw new BadRequestException(Message.BAD_REQUEST);
		// Keep parent visibility filtering and comment listing in one aggregation.
		const match = {
			commentRefId: ref,
			commentGroup: CommentGroup.ARTICLE,
			...(!admin ? { commentStatus: CommentStatus.ACTIVE } : status ? { commentStatus: status } : {}),
		};
		const [article] = await this.articles
			.aggregate<{ comments: Comments[] }>([
				{ $match: { _id: ref, ...(!admin ? { articleStatus: BoardArticleStatus.ACTIVE } : {}) } },
				{
					$lookup: {
						from: 'comments',
						pipeline: [
							{ $match: match },
							{ $sort: { [sort]: direction, _id: direction } },
							{
								$facet: {
									list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, ...this.authorStages()],
									metaCounter: [{ $count: 'total' }],
								},
							},
						],
						as: 'comments',
					},
				},
			])
			.exec();
		if (!article) throw new NotFoundException(Message.NO_DATA_FOUND);
		return article.comments[0] ?? { list: [], metaCounter: [] };
	}

	private async requireArticle(id: Types.ObjectId, session: ClientSession, activeOnly: boolean): Promise<void> {
		const article = await this.articles
			.findOne({ _id: id, ...(activeOnly ? { articleStatus: BoardArticleStatus.ACTIVE } : {}) })
			.session(session)
			.exec();
		if (!article) throw new NotFoundException(Message.NO_DATA_FOUND);
	}

	private async syncCount(id: Types.ObjectId, session: ClientSession, activeOnly: boolean): Promise<void> {
		const count = await this.comments
			.countDocuments({ commentRefId: id, commentGroup: CommentGroup.ARTICLE, commentStatus: CommentStatus.ACTIVE })
			.session(session)
			.exec();
		// Updating the parent also serializes edits/removal against article deletion and other comment mutations.
		const article = await this.articles
			.findOneAndUpdate(
				{ _id: id, ...(activeOnly ? { articleStatus: BoardArticleStatus.ACTIVE } : {}) },
				{ $set: { articleComments: count } },
				{ new: true, runValidators: true, session },
			)
			.exec();
		if (!article) throw new ConflictException(Message.UPDATE_FAILED);
	}

	private async load(id: Types.ObjectId, session: ClientSession): Promise<Comment> {
		const [comment] = await this.comments
			.aggregate<Comment>([{ $match: { _id: id, commentGroup: CommentGroup.ARTICLE } }, ...this.authorStages()])
			.session(session)
			.exec();
		if (!comment) throw new NotFoundException(Message.NO_DATA_FOUND);
		return comment;
	}

	private authorStages(): Array<PipelineStage.Lookup | PipelineStage.Unwind> {
		const fields = [
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
		return [
			{
				$lookup: {
					from: 'members',
					localField: 'memberId',
					foreignField: '_id',
					pipeline: [{ $project: Object.fromEntries(fields.map((key) => [key, 1])) }],
					as: 'memberData',
				},
			},
			{ $unwind: { path: '$memberData', preserveNullAndEmptyArrays: true } },
		];
	}

	private objectId(value: string): Types.ObjectId {
		if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value))
			throw new BadRequestException(Message.BAD_REQUEST);
		return new Types.ObjectId(value);
	}
	private content(value: string): string {
		if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 100)
			throw new BadRequestException(Message.BAD_REQUEST);
		return value.trim();
	}
	private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
		const session = await this.comments.db.startSession();
		try {
			const result = await session.withTransaction(() => work(session));
			if (result === undefined) throw new InternalServerErrorException(Message.UPDATE_FAILED);
			return result;
		} finally {
			await session.endSession();
		}
	}
}
