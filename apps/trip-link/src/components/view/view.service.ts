import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, PipelineStage, Types } from 'mongoose';
import { VisitedToursInquiry } from '../../libs/dto/tour/tour.input';
import { Tours } from '../../libs/dto/tour/tour';
import { Message } from '../../libs/enums/common.enum';
import { TourStatus } from '../../libs/enums/tour.enum';
import { ViewGroup } from '../../libs/enums/view.enum';

export interface ViewInput {
	memberId: string;
	viewRefId: string;
	viewGroup: ViewGroup;
}

type ViewRecord = {
	memberId: Types.ObjectId;
	viewRefId: Types.ObjectId;
	viewGroup: ViewGroup;
};

@Injectable()
export class ViewService {
	constructor(@InjectModel('View') private readonly viewModel: Model<ViewRecord>) {}

	public async recordView(input: ViewInput, session: ClientSession): Promise<boolean> {
		this.requireActiveTransaction(session);
		const search = this.buildSearch(input);
		const existingView = await this.viewModel.findOne(search).session(session).exec();
		if (existingView) {
			await this.viewModel
				.updateOne({ _id: existingView._id }, { $set: { updatedAt: new Date() } }, { session, timestamps: false })
				.exec();
			return false;
		}

		await this.viewModel.create([search], { session });
		return true;
	}

	public async countTargetViews(viewRefId: string, viewGroup: ViewGroup, session: ClientSession): Promise<number> {
		this.requireActiveTransaction(session);
		if (!isValidObjectId(viewRefId) || !Object.values(ViewGroup).includes(viewGroup)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		return this.viewModel
			.countDocuments({ viewRefId: new Types.ObjectId(viewRefId), viewGroup })
			.session(session)
			.exec();
	}

	public async getVisitedTours(memberId: string, input: VisitedToursInquiry): Promise<Tours> {
		if (!isValidObjectId(memberId)) throw new BadRequestException(Message.BAD_REQUEST);

		const [result] = await this.viewModel
			.aggregate<Tours>([
				{
					$match: {
						memberId: new Types.ObjectId(memberId),
						viewGroup: ViewGroup.TOUR,
					},
				},
				{
					$lookup: {
						from: 'tours',
						localField: 'viewRefId',
						foreignField: '_id',
						as: 'visitedTour',
					},
				},
				{ $unwind: '$visitedTour' },
				{
					$match: {
						'visitedTour.tourStatus': { $in: [TourStatus.ACTIVE, TourStatus.SOLD_OUT] },
					},
				},
				{ $sort: { updatedAt: -1 } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{ $replaceRoot: { newRoot: '$visitedTour' } },
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

	private buildSearch(input: ViewInput): ViewRecord {
		if (
			!isValidObjectId(input.memberId) ||
			!isValidObjectId(input.viewRefId) ||
			!Object.values(ViewGroup).includes(input.viewGroup)
		) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		return {
			memberId: new Types.ObjectId(input.memberId),
			viewRefId: new Types.ObjectId(input.viewRefId),
			viewGroup: input.viewGroup,
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
