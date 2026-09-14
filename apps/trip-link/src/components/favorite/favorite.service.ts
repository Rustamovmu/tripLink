import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, PipelineStage, Types } from 'mongoose';
import { FavoriteToursInquiry } from '../../libs/dto/tour/tour.input';
import { Tours } from '../../libs/dto/tour/tour';
import { Message } from '../../libs/enums/common.enum';
import { TourStatus } from '../../libs/enums/tour.enum';

export interface FavoriteToggleInput {
	memberId: string;
	tourId: string;
}

type FavoriteRecord = {
	memberId: Types.ObjectId;
	tourId: Types.ObjectId;
};

@Injectable()
export class FavoriteService {
	constructor(@InjectModel('Favorite') private readonly favoriteModel: Model<FavoriteRecord>) {}

	public async toggleFavorite(input: FavoriteToggleInput, session: ClientSession): Promise<boolean> {
		this.requireActiveTransaction(session);
		const search = this.buildSearch(input);
		const removedFavorite = await this.favoriteModel.findOneAndDelete(search).session(session).exec();
		if (removedFavorite) return false;

		await this.favoriteModel.create([search], { session });
		return true;
	}

	public async countTourFavorites(tourId: string, session: ClientSession): Promise<number> {
		this.requireActiveTransaction(session);
		if (!isValidObjectId(tourId)) throw new BadRequestException(Message.BAD_REQUEST);

		return this.favoriteModel
			.countDocuments({ tourId: new Types.ObjectId(tourId) })
			.session(session)
			.exec();
	}

	public async getFavoriteTours(memberId: string, input: FavoriteToursInquiry): Promise<Tours> {
		if (!isValidObjectId(memberId)) throw new BadRequestException(Message.BAD_REQUEST);

		const [result] = await this.favoriteModel
			.aggregate<Tours>([
				{ $match: { memberId: new Types.ObjectId(memberId) } },
				{
					$lookup: {
						from: 'tours',
						localField: 'tourId',
						foreignField: '_id',
						as: 'favoriteTour',
					},
				},
				{ $unwind: '$favoriteTour' },
				{
					$match: {
						'favoriteTour.tourStatus': { $in: [TourStatus.ACTIVE, TourStatus.SOLD_OUT] },
					},
				},
				{ $sort: { createdAt: -1 } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{ $replaceRoot: { newRoot: '$favoriteTour' } },
							this.agentLookup(),
							{ $unwind: { path: '$agentData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		return result ?? { list: [], metaCounter: [] };
	}

	private buildSearch(input: FavoriteToggleInput): FavoriteRecord {
		if (!isValidObjectId(input.memberId) || !isValidObjectId(input.tourId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		return {
			memberId: new Types.ObjectId(input.memberId),
			tourId: new Types.ObjectId(input.tourId),
		};
	}

	private requireActiveTransaction(session: ClientSession): void {
		if (!session.inTransaction()) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
	}

	private agentLookup(): PipelineStage.Lookup {
		return {
			$lookup: {
				from: 'members',
				let: { agentId: '$agentId' },
				pipeline: [
					{ $match: { $expr: { $eq: ['$_id', '$$agentId'] } } },
					{
						$project: {
							memberPassword: 0,
							memberEmail: 0,
							memberPhone: 0,
							memberPhoneCountryCode: 0,
							memberAddress: 0,
						},
					},
				],
				as: 'agentData',
			},
		};
	}
}
