import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, PipelineStage, Types } from 'mongoose';
import {
	AgentToursInquiry,
	AllToursInquiry,
	FavoriteToursInquiry,
	TourInput,
	ToursInquiry,
	VisitedToursInquiry,
} from '../../libs/dto/tour/tour.input';
import { FavoriteToggleResult, Tour, Tours } from '../../libs/dto/tour/tour';
import { TourAdminUpdate, TourUpdate } from '../../libs/dto/tour/tour.update';
import { Direction, Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { TourStatus } from '../../libs/enums/tour.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { FavoriteService } from '../favorite/favorite.service';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';

type TourDocumentShape = Tour & { __v?: number };
const PUBLIC_TOUR_STATUSES = [TourStatus.ACTIVE, TourStatus.SOLD_OUT];

@Injectable()
export class TourService {
	constructor(
		@InjectModel('Tour') private readonly tourModel: Model<TourDocumentShape>,
		private readonly favoriteService: FavoriteService,
		private readonly memberService: MemberService,
		private readonly viewService: ViewService,
	) {}

	public async createTour(agentId: string, input: TourInput): Promise<Tour> {
		if (!isValidObjectId(agentId) || Object.values(input).some((value) => value === null)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		this.validateTourBusinessRules(input);
		const _id = new Types.ObjectId();
		const tourSlug = `${this.slugify(input.tourTitle)}-${_id.toHexString().slice(-8)}`;
		const createdTour = new this.tourModel({
			...this.normalizeTourInput(input),
			_id,
			tourSlug,
			tourStatus: TourStatus.DRAFT,
			agentId: new Types.ObjectId(agentId),
		});

		try {
			await createdTour.save();
			await this.memberService.increaseMemberTourCount(agentId);
			return createdTour.toObject();
		} catch (error: unknown) {
			if (!createdTour.isNew) await this.tourModel.deleteOne({ _id: createdTour._id }).exec();
			if (error instanceof BadRequestException || error instanceof ForbiddenException) throw error;
			if (this.isDuplicateKeyError(error)) throw new ConflictException(Message.CREATE_FAILED);
			if (this.isMongooseInputError(error)) throw new BadRequestException(Message.BAD_REQUEST);
			throw new InternalServerErrorException(Message.CREATE_FAILED);
		}
	}

	public async getTour(tourId: string, viewerId: string | null = null): Promise<Tour> {
		if (!isValidObjectId(tourId)) throw new BadRequestException(Message.BAD_REQUEST);

		const [tour] = await this.tourModel
			.aggregate<Tour>([
				{
					$match: {
						_id: new Types.ObjectId(tourId),
						tourStatus: { $in: PUBLIC_TOUR_STATUSES },
					},
				},
				this.agentLookup(),
				{ $unwind: { path: '$agentData', preserveNullAndEmptyArrays: true } },
			])
			.exec();

		if (!tour) throw new NotFoundException(Message.NO_DATA_FOUND);
		if (viewerId) tour.tourViewCount = await this.recordTourView(viewerId, tourId, tour.tourViewCount);
		return tour;
	}

	private async recordTourView(viewerId: string, tourId: string, currentViewCount: number): Promise<number> {
		const session = await this.tourModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<number> => {
				const recorded = await this.viewService.recordView(
					{ memberId: viewerId, viewRefId: tourId, viewGroup: ViewGroup.TOUR },
					session,
				);
				if (!recorded) return currentViewCount;

				const tourViewCount = await this.viewService.countTargetViews(tourId, ViewGroup.TOUR, session);
				const updatedTour = await this.tourModel
					.findOneAndUpdate(
						{ _id: tourId, tourStatus: { $in: PUBLIC_TOUR_STATUSES } },
						{ $set: { tourViewCount } },
						{ new: true, session, timestamps: false },
					)
					.lean<Tour>()
					.exec();
				if (!updatedTour) throw new ConflictException(Message.UPDATE_FAILED);

				return updatedTour.tourViewCount;
			});

			if (result === undefined) throw new InternalServerErrorException(Message.UPDATE_FAILED);
			return result;
		} catch (error: unknown) {
			this.rethrowUpdateError(error);
		} finally {
			await session.endSession();
		}
	}

	public async updateTour(agentId: string, input: TourUpdate): Promise<Tour> {
		if (!isValidObjectId(agentId) || !isValidObjectId(input.tourId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
		if (Object.values(input).some((value) => value === null)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const agent = await this.memberService.getMember(agentId);
		if (agent.memberType !== MemberType.AGENT) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const existingTour = await this.tourModel.findOne({ _id: input.tourId, agentId }).lean().exec();
		if (!existingTour) throw new NotFoundException(Message.NO_DATA_FOUND);
		if ([TourStatus.COMPLETED, TourStatus.CANCELLED].includes(existingTour.tourStatus)) {
			throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);
		}

		const requestedFields: Partial<TourUpdate> = { ...input };
		delete requestedFields.tourId;
		if (Object.keys(requestedFields).length === 0) throw new BadRequestException(Message.NO_UPDATE_FIELDS);
		this.validateAgentStatusTransition(existingTour.tourStatus, requestedFields.tourStatus);

		const update = this.normalizeTourUpdate(requestedFields);
		const mergedTour = { ...existingTour, ...update } as TourInput & { tourStatus: TourStatus };
		const requirePublishable = [TourStatus.PENDING, TourStatus.ACTIVE, TourStatus.SOLD_OUT].includes(
			mergedTour.tourStatus,
		);
		this.validateTourBusinessRules(mergedTour, requirePublishable);

		try {
			const updatedTour = await this.tourModel
				.findOneAndUpdate(
					{ _id: input.tourId, agentId, tourStatus: existingTour.tourStatus },
					{ $set: update },
					{ new: true, runValidators: true },
				)
				.lean<Tour>()
				.exec();

			if (!updatedTour) throw new ConflictException(Message.UPDATE_FAILED);
			return updatedTour;
		} catch (error: unknown) {
			this.rethrowUpdateError(error);
		}
	}

	public async getTours(input: ToursInquiry): Promise<Tours> {
		const match: Record<string, unknown> = { tourStatus: { $in: PUBLIC_TOUR_STATUSES } };
		this.shapePublicTourMatch(match, input);

		return this.aggregateTours(match, input.page, input.limit, input.sort, input.direction);
	}

	public async getAgentTours(agentId: string, input: AgentToursInquiry): Promise<Tours> {
		if (!isValidObjectId(agentId)) throw new BadRequestException(Message.BAD_REQUEST);

		const agent = await this.memberService.getMember(agentId);
		if (agent.memberType !== MemberType.AGENT) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const match: Record<string, unknown> = { agentId: new Types.ObjectId(agentId) };
		if (input.search.tourStatus) match.tourStatus = input.search.tourStatus;
		if (input.search.text?.trim()) match.$text = { $search: input.search.text.trim() };

		return this.aggregateTours(match, input.page, input.limit, input.sort, input.direction);
	}

	public async getAllToursByAdmin(input: AllToursInquiry): Promise<Tours> {
		const match: Record<string, unknown> = {};
		if (input.search.tourStatus) match.tourStatus = input.search.tourStatus;
		if (input.search.categories?.length) match.tourCategory = { $in: input.search.categories };
		if (input.search.agentId) match.agentId = new Types.ObjectId(input.search.agentId);
		if (input.search.featured !== undefined) match.tourFeatured = input.search.featured;
		if (input.search.text?.trim()) match.$text = { $search: input.search.text.trim() };

		return this.aggregateTours(match, input.page, input.limit, input.sort, input.direction);
	}

	public async updateTourByAdmin(input: TourAdminUpdate): Promise<Tour> {
		if (!isValidObjectId(input.tourId) || Object.values(input).some((value) => value === null)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const update: Partial<Omit<TourAdminUpdate, 'tourId'>> = { ...input };
		delete (update as Partial<TourAdminUpdate>).tourId;
		if (Object.keys(update).length === 0) throw new BadRequestException(Message.NO_UPDATE_FIELDS);

		const existingTour = await this.tourModel.findById(input.tourId).lean().exec();
		if (!existingTour) throw new NotFoundException(Message.NO_DATA_FOUND);
		this.validateAdminStatusTransition(existingTour.tourStatus, update.tourStatus);
		if (update.tourStatus && update.tourStatus !== TourStatus.ACTIVE) update.tourFeatured = false;

		const mergedTour = { ...existingTour, ...update } as TourInput & {
			tourStatus: TourStatus;
			tourFeatured: boolean;
		};
		if (mergedTour.tourStatus === TourStatus.ACTIVE) {
			this.validateTourBusinessRules(mergedTour, true);
			if (mergedTour.tourAvailableSeats < 1) throw new BadRequestException(Message.BAD_REQUEST);
		}
		if (mergedTour.tourStatus === TourStatus.SOLD_OUT && mergedTour.tourAvailableSeats !== 0) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
		if (mergedTour.tourFeatured && mergedTour.tourStatus !== TourStatus.ACTIVE) {
			throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		}

		try {
			const updatedTour = await this.tourModel
				.findOneAndUpdate(
					{ _id: input.tourId, tourStatus: existingTour.tourStatus },
					{ $set: update },
					{ new: true, runValidators: true },
				)
				.lean<Tour>()
				.exec();

			if (!updatedTour) throw new ConflictException(Message.UPDATE_FAILED);
			return updatedTour;
		} catch (error: unknown) {
			this.rethrowUpdateError(error);
		}
	}

	public async toggleFavoriteTour(memberId: string, tourId: string): Promise<FavoriteToggleResult> {
		if (!isValidObjectId(memberId) || !isValidObjectId(tourId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberService.getMember(memberId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const session = await this.tourModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<FavoriteToggleResult> => {
				const tourExists = await this.tourModel
					.exists({ _id: tourId, tourStatus: { $in: PUBLIC_TOUR_STATUSES } })
					.session(session);
				if (!tourExists) throw new NotFoundException(Message.NO_DATA_FOUND);

				const favorited = await this.favoriteService.toggleFavorite({ memberId, tourId }, session);
				const tourFavoriteCount = await this.favoriteService.countTourFavorites(tourId, session);
				const tour = await this.tourModel
					.findOneAndUpdate(
						{ _id: tourId, tourStatus: { $in: PUBLIC_TOUR_STATUSES } },
						{ $set: { tourFavoriteCount } },
						{ new: true, session, timestamps: false },
					)
					.lean<Tour>()
					.exec();

				if (!tour) throw new ConflictException(Message.UPDATE_FAILED);
				return { tour, favorited };
			});

			if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
			return result;
		} catch (error: unknown) {
			this.rethrowUpdateError(error);
		} finally {
			await session.endSession();
		}
	}

	public async getFavoriteTours(memberId: string, input: FavoriteToursInquiry): Promise<Tours> {
		if (!isValidObjectId(memberId)) throw new BadRequestException(Message.BAD_REQUEST);

		const member = await this.memberService.getMember(memberId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		return this.favoriteService.getFavoriteTours(memberId, input);
	}

	public async getVisitedTours(memberId: string, input: VisitedToursInquiry): Promise<Tours> {
		if (!isValidObjectId(memberId)) throw new BadRequestException(Message.BAD_REQUEST);

		const member = await this.memberService.getMember(memberId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		return this.viewService.getVisitedTours(memberId, input);
	}

	private async aggregateTours(
		match: Record<string, unknown>,
		page: number,
		limit: number,
		sort: ToursInquiry['sort'],
		direction: Direction | undefined,
	): Promise<Tours> {
		const sortField = sort === 'tourPrice' ? 'effectiveTourPrice' : (sort ?? 'createdAt');
		const sortDirection = direction ?? Direction.DESC;
		const [result] = await this.tourModel
			.aggregate<Tours>([
				{ $match: match },
				{ $addFields: { effectiveTourPrice: { $ifNull: ['$tourDiscountPrice', '$tourPrice'] } } },
				{ $sort: { [sortField]: sortDirection } },
				{
					$facet: {
						list: [
							{ $skip: (page - 1) * limit },
							{ $limit: limit },
							this.agentLookup(),
							{ $unwind: { path: '$agentData', preserveNullAndEmptyArrays: true } },
							{ $unset: 'effectiveTourPrice' },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		return result ?? { list: [], metaCounter: [] };
	}

	private validateTourBusinessRules(input: TourInput, requirePublishable = false): void {
		if (input.tourDiscountPrice !== undefined && input.tourDiscountPrice > input.tourPrice) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		if (input.tourAvailableDates.some((date) => date.startDate >= date.endDate)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const totalAvailableSeats = input.tourAvailableDates.reduce((total, date) => total + date.availableSeats, 0);
		if (totalAvailableSeats !== input.tourAvailableSeats) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const itineraryDays = new Set(input.tourItinerary.map((item) => item.day));
		if (
			itineraryDays.size !== input.tourItinerary.length ||
			input.tourItinerary.some((item) => item.day > input.tourDurationDays)
		) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		if (
			requirePublishable &&
			(!input.tourImages.length || !input.tourAvailableDates.length || !input.tourItinerary.length)
		) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
	}

	private normalizeTourInput(input: TourInput): TourInput {
		return {
			...input,
			tourTitle: input.tourTitle.trim(),
			tourDescription: input.tourDescription.trim(),
			tourDestination: input.tourDestination.trim(),
			tourCountry: input.tourCountry.trim(),
			tourCity: input.tourCity.trim(),
			tourImages: input.tourImages.map((value) => value.trim()),
			tourLanguages: input.tourLanguages.map((value) => value.trim()),
			tourTransportation: input.tourTransportation.map((value) => value.trim()),
			tourAccommodation: input.tourAccommodation?.trim(),
			tourMeals: input.tourMeals.map((value) => value.trim()),
			tourItinerary: input.tourItinerary.map((item) => ({
				...item,
				title: item.title.trim(),
				description: item.description.trim(),
			})),
			tourIncludedServices: input.tourIncludedServices.map((value) => value.trim()),
			tourExcludedServices: input.tourExcludedServices.map((value) => value.trim()),
		};
	}

	private normalizeTourUpdate(input: Partial<Omit<TourUpdate, 'tourId'>>): Partial<Omit<TourUpdate, 'tourId'>> {
		const normalized = { ...input };
		if (input.tourTitle !== undefined) normalized.tourTitle = input.tourTitle.trim();
		if (input.tourDescription !== undefined) normalized.tourDescription = input.tourDescription.trim();
		if (input.tourDestination !== undefined) normalized.tourDestination = input.tourDestination.trim();
		if (input.tourCountry !== undefined) normalized.tourCountry = input.tourCountry.trim();
		if (input.tourCity !== undefined) normalized.tourCity = input.tourCity.trim();
		if (input.tourImages !== undefined) normalized.tourImages = input.tourImages.map((value) => value.trim());
		if (input.tourLanguages !== undefined) normalized.tourLanguages = input.tourLanguages.map((value) => value.trim());
		if (input.tourTransportation !== undefined) {
			normalized.tourTransportation = input.tourTransportation.map((value) => value.trim());
		}
		if (input.tourAccommodation !== undefined) normalized.tourAccommodation = input.tourAccommodation.trim();
		if (input.tourMeals !== undefined) normalized.tourMeals = input.tourMeals.map((value) => value.trim());
		if (input.tourItinerary !== undefined) {
			normalized.tourItinerary = input.tourItinerary.map((item) => ({
				...item,
				title: item.title.trim(),
				description: item.description.trim(),
			}));
		}
		if (input.tourIncludedServices !== undefined) {
			normalized.tourIncludedServices = input.tourIncludedServices.map((value) => value.trim());
		}
		if (input.tourExcludedServices !== undefined) {
			normalized.tourExcludedServices = input.tourExcludedServices.map((value) => value.trim());
		}
		return normalized;
	}

	private validateAgentStatusTransition(currentStatus: TourStatus, requestedStatus?: TourStatus): void {
		if (!requestedStatus || requestedStatus === currentStatus) return;

		const allowedTransitions: Partial<Record<TourStatus, TourStatus[]>> = {
			[TourStatus.DRAFT]: [TourStatus.PENDING, TourStatus.CANCELLED],
			[TourStatus.PENDING]: [TourStatus.DRAFT, TourStatus.CANCELLED],
			[TourStatus.ACTIVE]: [TourStatus.CANCELLED],
			[TourStatus.SOLD_OUT]: [TourStatus.CANCELLED],
		};

		if (!allowedTransitions[currentStatus]?.includes(requestedStatus)) {
			throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);
		}
	}

	private validateAdminStatusTransition(currentStatus: TourStatus, requestedStatus?: TourStatus): void {
		if (!requestedStatus || requestedStatus === currentStatus) return;

		const allowedTransitions: Partial<Record<TourStatus, TourStatus[]>> = {
			[TourStatus.DRAFT]: [TourStatus.CANCELLED],
			[TourStatus.PENDING]: [TourStatus.DRAFT, TourStatus.ACTIVE, TourStatus.CANCELLED],
			[TourStatus.ACTIVE]: [TourStatus.SOLD_OUT, TourStatus.COMPLETED, TourStatus.CANCELLED],
			[TourStatus.SOLD_OUT]: [TourStatus.ACTIVE, TourStatus.COMPLETED, TourStatus.CANCELLED],
		};

		if (!allowedTransitions[currentStatus]?.includes(requestedStatus)) {
			throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);
		}
	}

	private shapePublicTourMatch(match: Record<string, unknown>, input: ToursInquiry): void {
		const search = input.search;
		if (search.agentId) match.agentId = new Types.ObjectId(search.agentId);
		if (search.destinations?.length) match.tourDestination = { $in: search.destinations };
		if (search.countries?.length) match.tourCountry = { $in: search.countries };
		if (search.cities?.length) match.tourCity = { $in: search.cities };
		if (search.categories?.length) match.tourCategory = { $in: search.categories };
		if (search.difficulties?.length) match.tourDifficulty = { $in: search.difficulties };

		if (search.priceRange) {
			this.validateRange(search.priceRange.start, search.priceRange.end);
			match.$expr = {
				$and: [
					{ $gte: [{ $ifNull: ['$tourDiscountPrice', '$tourPrice'] }, search.priceRange.start] },
					{ $lte: [{ $ifNull: ['$tourDiscountPrice', '$tourPrice'] }, search.priceRange.end] },
				],
			};
		}

		if (search.durationRange) {
			this.validateRange(search.durationRange.start, search.durationRange.end);
			match.tourDurationDays = { $gte: search.durationRange.start, $lte: search.durationRange.end };
		}

		if (search.availableDateRange) {
			this.validateRange(search.availableDateRange.start.getTime(), search.availableDateRange.end.getTime());
			const availableDateMatch: Record<string, unknown> = {
				startDate: { $lte: search.availableDateRange.end },
				endDate: { $gte: search.availableDateRange.start },
			};
			if (search.minimumAvailableSeats !== undefined) {
				availableDateMatch.availableSeats = { $gte: search.minimumAvailableSeats };
			}
			match.tourAvailableDates = { $elemMatch: availableDateMatch };
		} else if (search.minimumAvailableSeats !== undefined) {
			match.tourAvailableSeats = { $gte: search.minimumAvailableSeats };
		}

		if (search.minimumRating !== undefined) match.tourAverageRating = { $gte: search.minimumRating };
		if (search.featured !== undefined) match.tourFeatured = search.featured;
		if (search.text?.trim()) match.$text = { $search: search.text.trim() };
	}

	private validateRange(start: number, end: number): void {
		if (start > end) throw new BadRequestException(Message.BAD_REQUEST);
	}

	private slugify(value: string): string {
		const slug = value
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80);
		return slug || 'tour';
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

	private isDuplicateKeyError(error: unknown): boolean {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
	}

	private isMongooseInputError(error: unknown): boolean {
		return error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError');
	}

	private rethrowUpdateError(error: unknown): never {
		if (
			error instanceof BadRequestException ||
			error instanceof ConflictException ||
			error instanceof ForbiddenException ||
			error instanceof NotFoundException
		) {
			throw error;
		}
		if (this.isDuplicateKeyError(error)) throw new ConflictException(Message.UPDATE_FAILED);
		if (this.isMongooseInputError(error)) throw new BadRequestException(Message.BAD_REQUEST);
		throw new InternalServerErrorException(Message.UPDATE_FAILED);
	}
}
