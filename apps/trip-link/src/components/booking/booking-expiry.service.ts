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
import { Booking } from '../../libs/dto/booking/booking';
import { Tour } from '../../libs/dto/tour/tour';
import { BookingStatus, PaymentStatus } from '../../libs/enums/booking.enum';
import { Message } from '../../libs/enums/common.enum';
import { TourStatus } from '../../libs/enums/tour.enum';

type BookingDocumentShape = Omit<Booking, '_id' | 'userId' | 'tourId' | 'agentId' | 'tourDateId'> & {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	tourId: Types.ObjectId;
	agentId: Types.ObjectId;
	tourDateId: Types.ObjectId;
	__v?: number;
};
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
export class BookingExpiryService {
	constructor(
		@InjectModel('Booking') private readonly bookingModel: Model<BookingDocumentShape>,
		@InjectModel('Tour') private readonly tourModel: Model<TourDocumentShape>,
	) {}

	public async expireBooking(bookingId: string, cutoff = new Date()): Promise<Booking> {
		if (!isValidObjectId(bookingId) || !Number.isFinite(cutoff.getTime()))
			throw new BadRequestException(Message.BAD_REQUEST);

		const session = await this.bookingModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<Booking> => {
				const booking = await this.bookingModel
					.findOne({
						_id: bookingId,
						bookingStatus: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
						paymentStatus: PaymentStatus.UNPAID,
					})
					.session(session)
					.lean<BookingDocumentShape>()
					.exec();
				if (!booking) throw new NotFoundException(Message.NO_DATA_FOUND);
				if (booking.selectedDate.getTime() > cutoff.getTime()) {
					throw new BadRequestException('Cannot expire a booking before its departure.');
				}

				if (booking.bookingStatus === BookingStatus.CONFIRMED) {
					const updatedTour = await this.tourModel
						.findOneAndUpdate(
							{
								_id: booking.tourId,
								tourStatus: { $in: [TourStatus.ACTIVE, TourStatus.SOLD_OUT, TourStatus.CANCELLED] },
								tourBookingCount: { $gte: 1 },
								$expr: { $eq: ['$tourAvailableSeats', { $sum: '$tourAvailableDates.availableSeats' }] },
								'tourAvailableDates._id': booking.tourDateId,
							},
							{
								$inc: {
									tourAvailableSeats: booking.numberOfPeople,
									'tourAvailableDates.$[selectedDate].availableSeats': booking.numberOfPeople,
									tourBookingCount: -1,
								},
							},
							{
								new: true,
								runValidators: true,
								session,
								arrayFilters: [{ 'selectedDate._id': booking.tourDateId }],
							},
						)
						.lean<TourDocumentShape>()
						.exec();
					if (!updatedTour) throw new ConflictException(Message.UPDATE_FAILED);

					if (updatedTour.tourStatus === TourStatus.SOLD_OUT) {
						await this.tourModel
							.updateOne(
								{ _id: booking.tourId, tourStatus: TourStatus.SOLD_OUT },
								{ $set: { tourStatus: TourStatus.ACTIVE } },
								{ session },
							)
							.exec();
					}
				}

				const cancelledBooking = await this.bookingModel
					.findOneAndUpdate(
						{
							_id: booking._id,
							bookingStatus: booking.bookingStatus,
							paymentStatus: PaymentStatus.UNPAID,
							selectedDate: { $lte: cutoff },
						},
						{
							$set: {
								bookingStatus: BookingStatus.CANCELLED,
								cancellationReason: 'Expired unpaid booking after departure.',
								cancelledAt: new Date(),
							},
						},
						{ new: true, runValidators: true, session },
					)
					.lean<Booking>()
					.exec();
				if (!cancelledBooking) throw new ConflictException(Message.UPDATE_FAILED);

				return cancelledBooking;
			});

			if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
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
			if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError')) {
				throw new BadRequestException(Message.BAD_REQUEST);
			}
			throw new InternalServerErrorException(Message.UPDATE_FAILED);
		} finally {
			await session.endSession();
		}
	}
}
