import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, Types } from 'mongoose';
import { Message } from '../../libs/enums/common.enum';

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
}
