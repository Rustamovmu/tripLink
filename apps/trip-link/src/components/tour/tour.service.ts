import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { TourInput } from '../../libs/dto/tour/tour.input';
import { Tour } from '../../libs/dto/tour/tour';
import { Message } from '../../libs/enums/common.enum';
import { TourStatus } from '../../libs/enums/tour.enum';
import { MemberService } from '../member/member.service';

type TourDocumentShape = Tour & { __v?: number };

@Injectable()
export class TourService {
	constructor(
		@InjectModel('Tour') private readonly tourModel: Model<TourDocumentShape>,
		private readonly memberService: MemberService,
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

	private validateTourBusinessRules(input: TourInput): void {
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

	private isDuplicateKeyError(error: unknown): boolean {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
	}

	private isMongooseInputError(error: unknown): boolean {
		return error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError');
	}
}
