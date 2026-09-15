import {
	BadRequestException,
	ConflictException,
	HttpException,
	Injectable,
	InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { FollowToggleResult } from '../../libs/dto/follow/follow';
import { Message } from '../../libs/enums/common.enum';
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

	private isDuplicateKeyError(error: unknown): boolean {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
	}
}
