import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { MemberStatus, MemberType } from '../../trip-link/src/libs/enums/member.enum';
import { TourStatus } from '../../trip-link/src/libs/enums/tour.enum';

export const RANKING_JOB = 'RECALCULATE_RANKINGS';
const PUBLIC_STATUSES = [TourStatus.ACTIVE, TourStatus.SOLD_OUT];
type AgentCandidate = { _id: Types.ObjectId; publicTours: Array<{ total: number }> };
export type RankingResult = { state: 'completed' | 'disabled' | 'busy' | 'stopping' };

@Injectable()
export class RankingService implements OnModuleDestroy {
	private readonly logger = new Logger(RankingService.name);
	private currentPass: Promise<RankingResult> | undefined;
	private stopping = false;

	constructor(
		@InjectModel('Tour') private readonly tours: Model<object>,
		@InjectModel('Member') private readonly members: Model<object>,
		private readonly config: ConfigService,
	) {}

	@Cron('0 0 1 * * *', { name: RANKING_JOB, timeZone: 'Asia/Seoul' })
	public async scheduledRanking(): Promise<void> {
		try {
			await this.runRanking();
		} catch {
			this.logger.error('Ranking recalculation failed; the next scheduled pass will retry.');
		}
	}

	public runRanking(): Promise<RankingResult> {
		if (this.stopping) return Promise.resolve({ state: 'stopping' });
		if (this.config.get<string>('BATCH_RANKING_ENABLED') !== 'true') return Promise.resolve({ state: 'disabled' });
		if (this.currentPass) return Promise.resolve({ state: 'busy' });
		const pass = this.recalculate();
		this.currentPass = pass;
		return pass.finally(() => {
			this.currentPass = undefined;
		});
	}

	public async onModuleDestroy(): Promise<void> {
		this.stopping = true;
		if (this.currentPass) await this.currentPass.catch(() => undefined);
	}

	private async recalculate(): Promise<RankingResult> {
		// Pipeline updates read each document's counters at the time of its write.
		// Do not alter business updatedAt timestamps or interaction counters.
		await this.tours
			.updateMany(
				{},
				[
					{
						$set: {
							tourRank: {
								$cond: [
									{ $in: ['$tourStatus', PUBLIC_STATUSES] },
									{
										$add: [
											{ $multiply: [{ $ifNull: ['$tourFavoriteCount', 0] }, 2] },
											{ $ifNull: ['$tourViewCount', 0] },
										],
									},
									0,
								],
							},
						},
					},
				],
				{ timestamps: false },
			)
			.exec();
		await this.members
			.updateMany(
				{ $or: [{ memberType: { $ne: MemberType.AGENT } }, { memberStatus: { $ne: MemberStatus.ACTIVE } }] },
				[{ $set: { agentRank: 0 } }],
				{ timestamps: false },
			)
			.exec();

		const cursor = this.members
			.aggregate<AgentCandidate>([
				{ $match: { memberType: MemberType.AGENT, memberStatus: MemberStatus.ACTIVE } },
				{
					$lookup: {
						from: 'tours',
						let: { agentId: '$_id' },
						pipeline: [
							{ $match: { $expr: { $eq: ['$agentId', '$$agentId'] }, tourStatus: { $in: PUBLIC_STATUSES } } },
							{ $count: 'total' },
						],
						as: 'publicTours',
					},
				},
				{ $project: { _id: 1, publicTours: 1 } },
			])
			.cursor({ batchSize: 100 });
		try {
			for await (const row of cursor) {
				const agent = row as AgentCandidate;
				if (this.stopping) return { state: 'stopping' };
				await this.members
					.updateOne(
						{ _id: agent._id },
						[
							{
								$set: {
									agentRank: {
										$cond: [
											{
												$and: [
													{ $eq: ['$memberType', MemberType.AGENT] },
													{ $eq: ['$memberStatus', MemberStatus.ACTIVE] },
												],
											},
											{
												$add: [
													(agent.publicTours[0]?.total ?? 0) * 5,
													{ $multiply: [{ $ifNull: ['$memberFollowers', 0] }, 3] },
													{ $multiply: [{ $ifNull: ['$memberLikes', 0] }, 2] },
													{ $ifNull: ['$memberViews', 0] },
												],
											},
											0,
										],
									},
								},
							},
						],
						{ timestamps: false },
					)
					.exec();
			}
		} finally {
			await cursor.close();
		}
		return { state: 'completed' };
	}
}
