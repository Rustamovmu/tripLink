import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, Types } from 'mongoose';
import { Message } from '../../libs/enums/common.enum';
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
		if (existingView) return false;

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
}
