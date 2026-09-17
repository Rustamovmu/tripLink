import {
	BadRequestException,
	ConflictException,
	HttpException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, PipelineStage, Types } from 'mongoose';
import { FollowInquiry } from '../../libs/dto/follow/follow.input';
import { FollowMembers, FollowToggleResult } from '../../libs/dto/follow/follow';
import { Direction, Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { MemberService } from '../member/member.service';

type FollowModifier = 1 | -1;

type FollowRecord = {
	followingId: Types.ObjectId;
	followerId: Types.ObjectId;
};

@Injectable()
export class FollowService {
	constructor(
		@InjectModel('Follow') private readonly followModel: Model<FollowRecord>,
		private readonly memberService: MemberService,
	) {}

	public async toggleFollowMember(followerId: string, followingId: string): Promise<FollowToggleResult> {
		if (!isValidObjectId(followerId) || !isValidObjectId(followingId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
		if (followerId.toLowerCase() === followingId.toLowerCase()) {
			throw new BadRequestException(Message.SELF_SUBSCRIPTION_DENIED);
		}

		const session = await this.followModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<FollowToggleResult> => {
				const search: FollowRecord = {
					followingId: new Types.ObjectId(followingId),
					followerId: new Types.ObjectId(followerId),
				};
				const removedFollow = await this.followModel.findOneAndDelete(search).session(session).exec();
				const modifier: FollowModifier = removedFollow ? -1 : 1;

				if (!removedFollow) await this.followModel.create([search], { session });

				const member = await this.memberService.adjustMemberFollowCounts(followerId, followingId, modifier, session);
				return { member, followed: modifier === 1 };
			});

			if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
			return result;
		} catch (error: unknown) {
			if (error instanceof HttpException) throw error;
			if (this.isDuplicateKeyError(error)) throw new ConflictException(Message.UPDATE_FAILED);
			throw new InternalServerErrorException(Message.UPDATE_FAILED);
		} finally {
			await session.endSession();
		}
	}

	public async getMemberFollowers(viewerId: string | null, input: FollowInquiry): Promise<FollowMembers> {
		return this.getFollowMembers(viewerId, input, 'followingId', 'followerId');
	}

	public async getMemberFollowings(viewerId: string | null, input: FollowInquiry): Promise<FollowMembers> {
		return this.getFollowMembers(viewerId, input, 'followerId', 'followingId');
	}

	private async getFollowMembers(
		viewerId: string | null,
		input: FollowInquiry,
		ownerField: 'followingId' | 'followerId',
		memberField: 'followingId' | 'followerId',
	): Promise<FollowMembers> {
		const { memberId } = input.search;
		if (!isValidObjectId(memberId) || (viewerId !== null && !isValidObjectId(viewerId))) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const targetMember = await this.memberService.getMember(memberId);
		if (![MemberType.USER, MemberType.AGENT].includes(targetMember.memberType)) {
			throw new NotFoundException(Message.NO_DATA_FOUND);
		}

		const memberIdExpression = `$${memberField}`;
		let viewerStateStages: PipelineStage.FacetPipelineStage[] = [{ $set: { isFollowing: false } }];
		if (viewerId) {
			viewerStateStages = [
				{
					$lookup: {
						from: 'follows',
						let: { targetId: memberIdExpression },
						pipeline: [
							{
								$match: {
									$expr: {
										$and: [
											{ $eq: ['$followerId', new Types.ObjectId(viewerId)] },
											{ $eq: ['$followingId', '$$targetId'] },
										],
									},
								},
							},
							{ $limit: 1 },
						],
						as: 'viewerFollow',
					},
				},
				{ $set: { isFollowing: { $gt: [{ $size: '$viewerFollow' }, 0] } } },
				{ $unset: 'viewerFollow' },
			];
		}

		const [result] = await this.followModel
			.aggregate<FollowMembers>([
				{ $match: { [ownerField]: new Types.ObjectId(memberId) } },
				{
					$lookup: {
						from: 'members',
						let: { memberId: memberIdExpression },
						pipeline: [
							{
								$match: {
									$expr: {
										$and: [
											{ $eq: ['$_id', '$$memberId'] },
											{ $in: ['$memberType', [MemberType.USER, MemberType.AGENT]] },
											{ $eq: ['$memberStatus', MemberStatus.ACTIVE] },
										],
									},
								},
							},
							{ $project: this.publicMemberProjection() },
						],
						as: 'memberData',
					},
				},
				{ $unwind: '$memberData' },
				{ $sort: { createdAt: Direction.DESC } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							...viewerStateStages,
							{ $set: { followedAt: '$createdAt' } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		return result ?? { list: [], metaCounter: [] };
	}

	private publicMemberProjection(): Record<string, 0 | 1> {
		return {
			_id: 1,
			memberType: 1,
			memberStatus: 1,
			memberNick: 1,
			memberFullname: 1,
			memberImage: 1,
			memberCountry: 1,
			memberDesc: 1,
			memberFavoriteDestinations: 1,
			memberTours: 1,
			memberReviews: 1,
			memberFollowers: 1,
			memberFollowings: 1,
			memberLikes: 1,
			memberViews: 1,
			memberComments: 1,
			createdAt: 1,
			updatedAt: 1,
		};
	}

	private isDuplicateKeyError(error: unknown): boolean {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
	}
}
