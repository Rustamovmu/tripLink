import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, Types } from 'mongoose';
import { Message } from '../../libs/enums/common.enum';
import { LikeGroup } from '../../libs/enums/like.enum';

export type LikeModifier = 1 | -1;

export interface LikeToggleInput {
	memberId: string;
	likeRefId: string;
	likeGroup: LikeGroup;
}

export type LikeTargetInput = Pick<LikeToggleInput, 'likeRefId' | 'likeGroup'>;

type LikeRecord = {
	likeGroup: LikeGroup;
	likeRefId: Types.ObjectId;
	memberId: Types.ObjectId;
};

type LikeSearch = Pick<LikeRecord, 'likeGroup' | 'likeRefId' | 'memberId'>;

@Injectable()
export class LikeService {
	constructor(@InjectModel('Like') private readonly likeModel: Model<LikeRecord>) {}

	public async toggleLike(input: LikeToggleInput, session: ClientSession): Promise<LikeModifier> {
		this.requireActiveTransaction(session);
		const search = this.buildSearch(input);
		const deletedLike = await this.likeModel.findOneAndDelete(search).session(session).exec();
		if (deletedLike) return -1;

		await this.likeModel.create([search], { session });
		return 1;
	}

	public async countTargetLikes(input: LikeTargetInput, session: ClientSession): Promise<number> {
		this.requireActiveTransaction(session);
		if (!isValidObjectId(input.likeRefId) || !Object.values(LikeGroup).includes(input.likeGroup)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		return this.likeModel
			.countDocuments({ likeRefId: new Types.ObjectId(input.likeRefId), likeGroup: input.likeGroup })
			.session(session)
			.exec();
	}

	private buildSearch(input: LikeToggleInput): LikeSearch {
		if (
			!isValidObjectId(input.memberId) ||
			!isValidObjectId(input.likeRefId) ||
			!Object.values(LikeGroup).includes(input.likeGroup)
		) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		return {
			memberId: new Types.ObjectId(input.memberId),
			likeRefId: new Types.ObjectId(input.likeRefId),
			likeGroup: input.likeGroup,
		};
	}

	private requireActiveTransaction(session: ClientSession): void {
		if (!session.inTransaction()) {
			throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		}
	}
}
