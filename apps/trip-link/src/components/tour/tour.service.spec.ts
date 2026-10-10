import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Direction } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { TourCategory, TourDifficulty, TourStatus } from '../../libs/enums/tour.enum';
import { TourService } from './tour.service';
import { TourAdminUpdate } from '../../libs/dto/tour/tour.update';

describe('TourService search and access boundaries', () => {
	const owner = new Types.ObjectId().toHexString();
	const aggregate = jest.fn();
	const exec = jest.fn();
	const getMember = jest.fn();
	const service = new TourService(
		{ aggregate } as unknown as ConstructorParameters<typeof TourService>[0],
		{} as ConstructorParameters<typeof TourService>[1],
		{} as ConstructorParameters<typeof TourService>[2],
		{ getMember } as unknown as ConstructorParameters<typeof TourService>[3],
		{} as ConstructorParameters<typeof TourService>[4],
	);
	beforeEach(() => {
		jest.resetAllMocks();
		aggregate.mockReturnValue({ exec });
		exec.mockResolvedValue([{ list: [], metaCounter: [] }]);
		getMember.mockResolvedValue({ memberType: MemberType.AGENT });
	});

	it('combines public filters and requires date overlap and seats on the same departure', async () => {
		const start = new Date('2035-01-01');
		const end = new Date('2035-01-03');
		await service.getTours({
			page: 2,
			limit: 3,
			search: {
				agentId: owner,
				destinations: ['Seoul'],
				countries: ['Korea'],
				cities: ['Seoul'],
				categories: [TourCategory.CITY],
				difficulties: [TourDifficulty.EASY],
				availableDateRange: { start, end },
				minimumAvailableSeats: 2,
				minimumRating: 4,
				featured: false,
				text: '  mountains  ',
			},
		});
		expect(pipeline()[0]).toEqual({
			$match: {
				tourStatus: { $in: [TourStatus.ACTIVE, TourStatus.SOLD_OUT] },
				agentId: new Types.ObjectId(owner),
				tourDestination: { $in: ['Seoul'] },
				tourCountry: { $in: ['Korea'] },
				tourCity: { $in: ['Seoul'] },
				tourCategory: { $in: [TourCategory.CITY] },
				tourDifficulty: { $in: [TourDifficulty.EASY] },
				tourAvailableDates: {
					$elemMatch: { startDate: { $lte: end }, endDate: { $gte: start }, availableSeats: { $gte: 2 } },
				},
				tourAverageRating: { $gte: 4 },
				tourFeatured: false,
				$text: { $search: 'mountains' },
			},
		});
	});

	it('filters and sorts by discounted price, applies duration and total-seat filters, and preserves facet totals', async () => {
		await service.getTours({
			page: 2,
			limit: 3,
			sort: 'tourPrice',
			direction: Direction.ASC,
			search: {
				priceRange: { start: 0, end: 50 },
				durationRange: { start: 1, end: 3 },
				minimumAvailableSeats: 2,
			},
		});
		const stages = pipeline();
		expect(stages[0]).toMatchObject({
			$match: {
				tourDurationDays: { $gte: 1, $lte: 3 },
				tourAvailableSeats: { $gte: 2 },
				$expr: {
					$and: [
						{ $gte: [{ $ifNull: ['$tourDiscountPrice', '$tourPrice'] }, 0] },
						{ $lte: [{ $ifNull: ['$tourDiscountPrice', '$tourPrice'] }, 50] },
					],
				},
			},
		});
		expect(stages[2]).toMatchObject({ $sort: { effectiveTourPrice: 1 } });
		expect(stages[3]).toMatchObject({
			$facet: {
				list: expect.arrayContaining([{ $skip: 3 }, { $limit: 3 }]) as unknown,
				metaCounter: [{ $count: 'total' }],
			},
		});
	});

	it('uses a stable ID tie-breaker for equal sort values (regression)', async () => {
		await service.getTours({ page: 1, limit: 10, sort: 'tourPrice', direction: Direction.ASC, search: {} });
		expect(pipeline()[2]).toEqual({ $sort: { effectiveTourPrice: 1, _id: 1 } });
	});

	it('rejects inverted ranges before querying', async () => {
		for (const search of [
			{ priceRange: { start: 50, end: 10 } },
			{ durationRange: { start: 5, end: 1 } },
			{ availableDateRange: { start: new Date('2035-01-02'), end: new Date('2035-01-01') } },
		])
			await expect(service.getTours({ page: 1, limit: 10, search })).rejects.toBeInstanceOf(BadRequestException);
		expect(aggregate).not.toHaveBeenCalled();
	});

	it('isolates agent listings and allows admin status and author filtering', async () => {
		await service.getAgentTours(owner, { page: 1, limit: 10, search: { tourStatus: TourStatus.DRAFT } });
		expect(pipeline()[0]).toEqual({
			$match: { agentId: new Types.ObjectId(owner), tourStatus: TourStatus.DRAFT },
		});
		await service.getAllToursByAdmin({
			page: 1,
			limit: 10,
			search: { agentId: owner, tourStatus: TourStatus.CANCELLED, featured: false },
		});
		expect(pipeline(1)[0]).toEqual({
			$match: {
				agentId: new Types.ObjectId(owner),
				tourStatus: TourStatus.CANCELLED,
				tourFeatured: false,
			},
		});
		getMember.mockResolvedValue({ memberType: MemberType.USER });
		await expect(service.getAgentTours(owner, { page: 1, limit: 10, search: {} })).rejects.toBeInstanceOf(
			ForbiddenException,
		);
	});

	it('strips author credentials and contact fields before serialization and preserves missing authors', async () => {
		await service.getTours({ page: 1, limit: 10, search: {} });
		const serialized = JSON.stringify(pipeline());
		for (const field of ['memberPassword', 'memberEmail', 'memberPhone', 'memberPhoneCountryCode', 'memberAddress'])
			expect(serialized).toContain(`"${field}":0`);
		expect(serialized).toContain('"preserveNullAndEmptyArrays":true');
	});

	it('propagates listing database failures as server failures', async () => {
		const failure = new Error('database unavailable');
		exec.mockRejectedValue(failure);
		await expect(service.getTours({ page: 1, limit: 10, search: {} })).rejects.toBe(failure);
	});
	function pipeline(call = 0): unknown[] {
		return (aggregate.mock.calls as unknown[][])[call][0] as unknown[];
	}
});

describe('TourService admin partial update regressions', () => {
	const tourId = new Types.ObjectId().toHexString();
	const endSession = jest.fn();
	const exec = jest.fn();
	const updateExec = jest.fn();
	const findOneAndUpdate = jest.fn();
	const session = { withTransaction: async (work: () => Promise<unknown>) => work(), endSession };
	const model = {
		db: { startSession: () => Promise.resolve(session) },
		findById: () => ({ session: () => ({ lean: () => ({ exec }) }) }),
		findOneAndUpdate,
	};
	const service = new TourService(
		model as unknown as ConstructorParameters<typeof TourService>[0],
		{} as ConstructorParameters<typeof TourService>[1],
		{} as ConstructorParameters<typeof TourService>[2],
		{} as ConstructorParameters<typeof TourService>[3],
		{} as ConstructorParameters<typeof TourService>[4],
	);
	beforeEach(() => {
		jest.resetAllMocks();
		exec.mockResolvedValue({
			tourStatus: TourStatus.ACTIVE,
			tourFeatured: false,
			tourAvailableSeats: 2,
			tourImages: ['tour.jpg'],
			tourAvailableDates: [{ startDate: new Date('2035-01-01'), endDate: new Date('2035-01-02'), availableSeats: 2 }],
			tourItinerary: [{ day: 1 }],
			tourDurationDays: 1,
			tourPrice: 100,
		});
		findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: updateExec }) });
		updateExec.mockResolvedValue({ _id: tourId, tourStatus: TourStatus.ACTIVE });
	});
	it.each([true, false])('changes only Featured to %s when the transformed DTO omits status', async (tourFeatured) => {
		const input = Object.assign(new TourAdminUpdate(), { tourId, tourFeatured });
		expect(Object.prototype.hasOwnProperty.call(input, 'tourStatus')).toBe(true);
		await service.updateTourByAdmin(input);
		expect(findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: tourId, tourStatus: TourStatus.ACTIVE },
			{ $set: { tourFeatured } },
			{ new: true, runValidators: true, session },
		);
		expect(endSession).toHaveBeenCalledTimes(1);
	});
	it('rejects a transformed empty update without opening a transaction', async () => {
		await expect(service.updateTourByAdmin(Object.assign(new TourAdminUpdate(), { tourId }))).rejects.toThrow();
		expect(findOneAndUpdate).not.toHaveBeenCalled();
		expect(endSession).not.toHaveBeenCalled();
	});
});
