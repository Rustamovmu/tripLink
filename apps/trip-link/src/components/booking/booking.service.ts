import { randomUUID } from 'node:crypto';
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingInput } from '../../libs/dto/booking/booking.input';
import { Booking } from '../../libs/dto/booking/booking';
import { Tour } from '../../libs/dto/tour/tour';
import { BookingStatus, PaymentStatus } from '../../libs/enums/booking.enum';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { TourStatus } from '../../libs/enums/tour.enum';
import { MemberService } from '../member/member.service';

type BookingDocumentShape = Booking & { __v?: number };
type TourDocumentShape = Omit<Tour, 'agentId' | 'tourAvailableDates'> & {
	agentId: Types.ObjectId;
	tourAvailableDates: Array<{
		_id: Types.ObjectId;
		startDate: Date;
		endDate: Date;
		availableSeats: number;
	}>;
	__v?: number;
};

@Injectable()
export class BookingService {
	constructor(
		@InjectModel('Booking') private readonly bookingModel: Model<BookingDocumentShape>,
		@InjectModel('Tour') private readonly tourModel: Model<TourDocumentShape>,
		private readonly memberService: MemberService,
	) {}

	public async createBooking(userId: string, input: BookingInput): Promise<Booking> {
		if (!isValidObjectId(userId) || !isValidObjectId(input.tourId) || !isValidObjectId(input.tourDateId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberService.getMember(userId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const session = await this.bookingModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<Booking> => {
				const tour = await this.tourModel
					.findOne({ _id: input.tourId, tourStatus: TourStatus.ACTIVE })
					.session(session)
					.lean<TourDocumentShape>()
					.exec();
				if (!tour) throw new NotFoundException(Message.NO_DATA_FOUND);
				if (tour.agentId.toHexString() === userId) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

				const selectedTourDate = tour.tourAvailableDates.find(
					(tourDate) => tourDate._id.toHexString() === input.tourDateId,
				);
				if (!selectedTourDate) throw new NotFoundException(Message.NO_DATA_FOUND);
				if (selectedTourDate.startDate.getTime() <= Date.now()) {
					throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
				}
				if (
					input.numberOfPeople > selectedTourDate.availableSeats ||
					input.numberOfPeople > tour.tourAvailableSeats ||
					input.numberOfPeople > tour.tourMaxGroupSize
				) {
					throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
				}

				const unitPrice = tour.tourDiscountPrice ?? tour.tourPrice;
				const totalPrice = Number((unitPrice * input.numberOfPeople).toFixed(2));
				const [createdBooking] = await this.bookingModel.create(
					[
						{
							bookingCode: this.generateBookingCode(),
							userId: new Types.ObjectId(userId),
							tourId: new Types.ObjectId(input.tourId),
							agentId: tour.agentId,
							tourDateId: new Types.ObjectId(input.tourDateId),
							selectedDate: selectedTourDate.startDate,
							numberOfPeople: input.numberOfPeople,
							unitPrice,
							totalPrice,
							bookingStatus: BookingStatus.PENDING,
							paymentStatus: PaymentStatus.UNPAID,
						},
					],
					{ session },
				);

				await this.memberService.increaseMemberBookingCount(userId, session);
				return createdBooking.toObject();
			});

			if (!result) throw new InternalServerErrorException(Message.CREATE_FAILED);
			return result;
		} catch (error: unknown) {
			if (
				error instanceof BadRequestException ||
				error instanceof ConflictException ||
				error instanceof ForbiddenException ||
				error instanceof NotFoundException ||
				error instanceof InternalServerErrorException
			) {
				throw error;
			}
			if (this.isDuplicateKeyError(error)) throw new ConflictException(Message.CREATE_FAILED);
			if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError')) {
				throw new BadRequestException(Message.BAD_REQUEST);
			}
			throw new InternalServerErrorException(Message.CREATE_FAILED);
		} finally {
			await session.endSession();
		}
	}

	private generateBookingCode(): string {
		return `TL-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.toUpperCase();
	}

	private isDuplicateKeyError(error: unknown): boolean {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
	}
}
