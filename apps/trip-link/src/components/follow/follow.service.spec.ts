import { ForbiddenException } from '@nestjs/common';
import { PipelineStage, Types } from 'mongoose';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { MemberService } from '../member/member.service';
import { FollowService } from './follow.service';

describe('FollowService', () => {
	const followerId = new Types.ObjectId().toHexString();
	const followingId = new Types.ObjectId().toHexString();
	const targetMember: Member = {
		_id: new Types.ObjectId(followingId) as unknown as Member['_id'],
		memberType: MemberType.AGENT,
		memberStatus: MemberStatus.ACTIVE,
		memberNick: 'target-agent',
		memberImage: '',
		memberFavoriteDestinations: [],
		memberTours: 0,
		memberReviews: 0,
		memberFollowers: 1,
		memberFollowings: 0,
		memberLikes: 0,
		memberViews: 0,
		memberComments: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	let deleteExec: jest.Mock;
	let session: {
		withTransaction: jest.Mock;
		endSession: jest.Mock;
	};
	let followModel: {
		db: { startSession: jest.Mock };
		findOneAndDelete: jest.Mock;
		create: jest.Mock;
		aggregate: jest.Mock;
	};
	let memberService: {
		adjustMemberFollowCounts: jest.Mock;
		getMember: jest.Mock;
	};
	let service: FollowService;

	beforeEach(() => {
		deleteExec = jest.fn();
		session = {
			withTransaction: jest.fn(async (callback: () => Promise<unknown>) => callback()),
			endSession: jest.fn().mockResolvedValue(undefined),
		};
		followModel = {
			db: { startSession: jest.fn().mockResolvedValue(session) },
			findOneAndDelete: jest.fn().mockReturnValue({
				session: jest.fn().mockReturnValue({ exec: deleteExec }),
			}),
			create: jest.fn().mockResolvedValue(undefined),
			aggregate: jest.fn(),
		};
		memberService = {
			adjustMemberFollowCounts: jest.fn().mockResolvedValue(targetMember),
			getMember: jest.fn().mockResolvedValue(targetMember),
		};

		service = new FollowService(followModel as never, memberService as unknown as MemberService);
	});

	it('rejects an invalid member id before starting a session', async () => {
		await expect(service.toggleFollowMember(followerId, 'invalid-id')).rejects.toThrow('Bad Request');
		expect(followModel.db.startSession).not.toHaveBeenCalled();
	});

	it('rejects self-following before starting a session', async () => {
		await expect(service.toggleFollowMember(followerId, followerId)).rejects.toThrow('Self subscription is denied!');
		expect(followModel.db.startSession).not.toHaveBeenCalled();
	});

	it('creates a follow and increments both member counters', async () => {
		deleteExec.mockResolvedValue(null);

		await expect(service.toggleFollowMember(followerId, followingId)).resolves.toEqual({
			member: targetMember,
			followed: true,
		});
		expect(followModel.create).toHaveBeenCalledWith(
			[
				{
					followerId: new Types.ObjectId(followerId),
					followingId: new Types.ObjectId(followingId),
				},
			],
			{ session },
		);
		expect(memberService.adjustMemberFollowCounts).toHaveBeenCalledWith(followerId, followingId, 1, session);
		expect(session.endSession).toHaveBeenCalledTimes(1);
	});

	it('removes an existing follow and decrements both member counters', async () => {
		deleteExec.mockResolvedValue({ _id: new Types.ObjectId() });

		await expect(service.toggleFollowMember(followerId, followingId)).resolves.toEqual({
			member: targetMember,
			followed: false,
		});
		expect(followModel.create).not.toHaveBeenCalled();
		expect(memberService.adjustMemberFollowCounts).toHaveBeenCalledWith(followerId, followingId, -1, session);
		expect(session.endSession).toHaveBeenCalledTimes(1);
	});

	it('propagates application errors and always closes the session', async () => {
		deleteExec.mockResolvedValue(null);
		memberService.adjustMemberFollowCounts.mockRejectedValue(new ForbiddenException('blocked'));

		await expect(service.toggleFollowMember(followerId, followingId)).rejects.toThrow('blocked');
		expect(session.endSession).toHaveBeenCalledTimes(1);
	});

	it('matches followingId when loading a member followers list', async () => {
		let capturedPipeline: PipelineStage[] = [];
		const aggregateExec = jest.fn().mockResolvedValue([{ list: [], metaCounter: [] }]);
		followModel.aggregate.mockImplementation((pipeline: PipelineStage[]) => {
			capturedPipeline = pipeline;
			return { exec: aggregateExec };
		});

		await expect(
			service.getMemberFollowers(null, {
				page: 1,
				limit: 20,
				search: { memberId: followingId },
			}),
		).resolves.toEqual({ list: [], metaCounter: [] });

		const match = (capturedPipeline[0] as PipelineStage.Match).$match as Record<string, Types.ObjectId>;
		expect(match.followingId.toHexString()).toBe(followingId);
	});

	it('matches followerId and returns an empty result when no aggregation document exists', async () => {
		let capturedPipeline: PipelineStage[] = [];
		const aggregateExec = jest.fn().mockResolvedValue([]);
		followModel.aggregate.mockImplementation((pipeline: PipelineStage[]) => {
			capturedPipeline = pipeline;
			return { exec: aggregateExec };
		});

		await expect(
			service.getMemberFollowings(null, {
				page: 1,
				limit: 20,
				search: { memberId: followerId },
			}),
		).resolves.toEqual({ list: [], metaCounter: [] });

		const match = (capturedPipeline[0] as PipelineStage.Match).$match as Record<string, Types.ObjectId>;
		expect(match.followerId.toHexString()).toBe(followerId);
	});
});
