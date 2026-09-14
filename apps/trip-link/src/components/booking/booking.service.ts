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
import {
	AgentBookingsInquiry,
	AllBookingsInquiry,
	BookingCancellationInput,
	BookingInput,
	BookingRejectionInput,
	BookingRefundInput,
	MyBookingsInquiry,
} from '../../libs/dto/booking/booking.input';
import { Booking, Bookings } from '../../libs/dto/booking/booking';
import { Tour } from '../../libs/dto/tour/tour';
import { BookingStatus, PaymentStatus } from '../../libs/enums/booking.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { TourStatus } from '../../libs/enums/tour.enum';
import { MemberService } from '../member/member.service';

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
							selectedEndDate: selectedTourDate.endDate,
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
				return createdBooking.toObject() as unknown as Booking;
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

	public async confirmBooking(agentId: string, bookingId: string): Promise<Booking> {
		if (!isValidObjectId(agentId) || !isValidObjectId(bookingId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberService.getMember(agentId);
		if (member.memberType !== MemberType.AGENT) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const session = await this.bookingModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<Booking> => {
				const booking = await this.bookingModel
					.findOne({
						_id: bookingId,
						agentId: new Types.ObjectId(agentId),
						bookingStatus: BookingStatus.PENDING,
					})
					.session(session)
					.lean<BookingDocumentShape>()
					.exec();
				if (!booking) throw new NotFoundException(Message.NO_DATA_FOUND);

				const now = new Date();
				const updatedTour = await this.tourModel
					.findOneAndUpdate(
						{
							_id: booking.tourId,
							tourStatus: TourStatus.ACTIVE,
							tourAvailableSeats: { $gte: booking.numberOfPeople },
							tourAvailableDates: {
								$elemMatch: {
									_id: booking.tourDateId,
									startDate: { $gt: now },
									availableSeats: { $gte: booking.numberOfPeople },
								},
							},
						},
						{
							$inc: {
								tourAvailableSeats: -booking.numberOfPeople,
								'tourAvailableDates.$[selectedDate].availableSeats': -booking.numberOfPeople,
								tourBookingCount: 1,
							},
						},
						{
							new: true,
							runValidators: true,
							session,
							arrayFilters: [
								{
									'selectedDate._id': booking.tourDateId,
									'selectedDate.startDate': { $gt: now },
									'selectedDate.availableSeats': { $gte: booking.numberOfPeople },
								},
							],
						},
					)
					.lean<TourDocumentShape>()
					.exec();
				if (!updatedTour) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

				if (updatedTour.tourAvailableSeats === 0) {
					await this.tourModel
						.updateOne(
							{ _id: booking.tourId, tourStatus: TourStatus.ACTIVE, tourAvailableSeats: 0 },
							{ $set: { tourStatus: TourStatus.SOLD_OUT, tourFeatured: false } },
							{ session },
						)
						.exec();
				}

				const confirmedBooking = await this.bookingModel
					.findOneAndUpdate(
						{
							_id: booking._id,
							agentId: new Types.ObjectId(agentId),
							bookingStatus: BookingStatus.PENDING,
						},
						{ $set: { bookingStatus: BookingStatus.CONFIRMED } },
						{ new: true, runValidators: true, session },
					)
					.lean<Booking>()
					.exec();
				if (!confirmedBooking) throw new ConflictException(Message.UPDATE_FAILED);

				return confirmedBooking;
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

	public async cancelBooking(userId: string, input: BookingCancellationInput): Promise<Booking> {
		if (!isValidObjectId(userId) || !isValidObjectId(input.bookingId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
		const cancellationReason = input.cancellationReason.trim();
		if (cancellationReason.length < 3) throw new BadRequestException(Message.BAD_REQUEST);

		const member = await this.memberService.getMember(userId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const session = await this.bookingModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<Booking> => {
				const booking = await this.bookingModel
					.findOne({
						_id: input.bookingId,
						userId: new Types.ObjectId(userId),
						bookingStatus: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
						paymentStatus: PaymentStatus.UNPAID,
					})
					.session(session)
					.lean<BookingDocumentShape>()
					.exec();
				if (!booking) throw new NotFoundException(Message.NO_DATA_FOUND);
				if (booking.selectedDate.getTime() <= Date.now()) {
					throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
				}

				if (booking.bookingStatus === BookingStatus.CONFIRMED) {
					const updatedTour = await this.tourModel
						.findOneAndUpdate(
							{
								_id: booking.tourId,
								tourStatus: { $in: [TourStatus.ACTIVE, TourStatus.SOLD_OUT, TourStatus.CANCELLED] },
								tourBookingCount: { $gte: 1 },
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
							userId: new Types.ObjectId(userId),
							bookingStatus: booking.bookingStatus,
							paymentStatus: PaymentStatus.UNPAID,
						},
						{
							$set: {
								bookingStatus: BookingStatus.CANCELLED,
								cancellationReason,
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

	public async getMyBookings(userId: string, input: MyBookingsInquiry): Promise<Bookings> {
		if (!isValidObjectId(userId)) throw new BadRequestException(Message.BAD_REQUEST);

		const member = await this.memberService.getMember(userId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const match: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
		if (input.search.bookingStatus) match.bookingStatus = input.search.bookingStatus;
		if (input.search.paymentStatus) match.paymentStatus = input.search.paymentStatus;
		return this.aggregateBookings(match, input, [{ localField: 'agentId', dataField: 'agentData' }]);
	}

	public async getAgentBookings(agentId: string, input: AgentBookingsInquiry): Promise<Bookings> {
		if (!isValidObjectId(agentId) || (input.search.tourId && !isValidObjectId(input.search.tourId))) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberService.getMember(agentId);
		if (member.memberType !== MemberType.AGENT) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const match: Record<string, unknown> = { agentId: new Types.ObjectId(agentId) };
		if (input.search.bookingStatus) match.bookingStatus = input.search.bookingStatus;
		if (input.search.paymentStatus) match.paymentStatus = input.search.paymentStatus;
		if (input.search.tourId) match.tourId = new Types.ObjectId(input.search.tourId);
		return this.aggregateBookings(match, input, [{ localField: 'userId', dataField: 'userData' }]);
	}

	public async rejectBooking(agentId: string, input: BookingRejectionInput): Promise<Booking> {
		if (!isValidObjectId(agentId) || !isValidObjectId(input.bookingId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
		const rejectionReason = input.rejectionReason.trim();
		if (rejectionReason.length < 3) throw new BadRequestException(Message.BAD_REQUEST);

		const member = await this.memberService.getMember(agentId);
		if (member.memberType !== MemberType.AGENT) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		try {
			const rejectedBooking = await this.bookingModel
				.findOneAndUpdate(
					{
						_id: input.bookingId,
						agentId: new Types.ObjectId(agentId),
						bookingStatus: BookingStatus.PENDING,
						paymentStatus: PaymentStatus.UNPAID,
					},
					{
						$set: {
							bookingStatus: BookingStatus.REJECTED,
							rejectionReason,
							rejectedAt: new Date(),
						},
					},
					{ new: true, runValidators: true },
				)
				.lean<Booking>()
				.exec();

			if (!rejectedBooking) throw new NotFoundException(Message.NO_DATA_FOUND);
			return rejectedBooking;
		} catch (error: unknown) {
			if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
			if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError')) {
				throw new BadRequestException(Message.BAD_REQUEST);
			}
			throw new InternalServerErrorException(Message.UPDATE_FAILED);
		}
	}

	public async getAllBookingsByAdmin(input: AllBookingsInquiry): Promise<Bookings> {
		const identifierFilters = [input.search.userId, input.search.agentId, input.search.tourId].filter(
			(identifier): identifier is string => identifier !== undefined,
		);
		if (identifierFilters.some((identifier) => !isValidObjectId(identifier))) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const match: Record<string, unknown> = {};
		if (input.search.bookingStatus) match.bookingStatus = input.search.bookingStatus;
		if (input.search.paymentStatus) match.paymentStatus = input.search.paymentStatus;
		if (input.search.userId) match.userId = new Types.ObjectId(input.search.userId);
		if (input.search.agentId) match.agentId = new Types.ObjectId(input.search.agentId);
		if (input.search.tourId) match.tourId = new Types.ObjectId(input.search.tourId);

		return this.aggregateBookings(match, input, [
			{ localField: 'userId', dataField: 'userData' },
			{ localField: 'agentId', dataField: 'agentData' },
		]);
	}

	public async payBooking(userId: string, bookingId: string): Promise<Booking> {
		if (!isValidObjectId(userId) || !isValidObjectId(bookingId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberService.getMember(userId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const now = new Date();
		const booking = await this.bookingModel
			.findOne({
				_id: bookingId,
				userId: new Types.ObjectId(userId),
				bookingStatus: BookingStatus.CONFIRMED,
				paymentStatus: PaymentStatus.UNPAID,
				selectedDate: { $gt: now },
			})
			.lean<BookingDocumentShape>()
			.exec();
		if (!booking) throw new NotFoundException(Message.NO_DATA_FOUND);

		const availableTour = await this.tourModel
			.exists({
				_id: booking.tourId,
				tourStatus: { $in: [TourStatus.ACTIVE, TourStatus.SOLD_OUT] },
			})
			.exec();
		if (!availableTour) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		try {
			const paidBooking = await this.bookingModel
				.findOneAndUpdate(
					{
						_id: booking._id,
						userId: new Types.ObjectId(userId),
						bookingStatus: BookingStatus.CONFIRMED,
						paymentStatus: PaymentStatus.UNPAID,
						selectedDate: { $gt: new Date() },
					},
					{
						$set: {
							paymentStatus: PaymentStatus.PAID,
							paymentReference: this.generatePaymentReference(),
							paidAt: new Date(),
						},
					},
					{ new: true, runValidators: true },
				)
				.lean<Booking>()
				.exec();

			if (!paidBooking) throw new ConflictException(Message.UPDATE_FAILED);
			return paidBooking;
		} catch (error: unknown) {
			if (
				error instanceof BadRequestException ||
				error instanceof ConflictException ||
				error instanceof NotFoundException
			) {
				throw error;
			}
			if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError')) {
				throw new BadRequestException(Message.BAD_REQUEST);
			}
			throw new InternalServerErrorException(Message.UPDATE_FAILED);
		}
	}

	public async refundBookingByAdmin(input: BookingRefundInput): Promise<Booking> {
		if (!isValidObjectId(input.bookingId)) throw new BadRequestException(Message.BAD_REQUEST);
		const refundReason = input.refundReason.trim();
		if (refundReason.length < 3) throw new BadRequestException(Message.BAD_REQUEST);

		const session = await this.bookingModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<Booking> => {
				const booking = await this.bookingModel
					.findOne({
						_id: input.bookingId,
						bookingStatus: BookingStatus.CONFIRMED,
						paymentStatus: PaymentStatus.PAID,
						selectedDate: { $gt: new Date() },
					})
					.session(session)
					.lean<BookingDocumentShape>()
					.exec();
				if (!booking) throw new NotFoundException(Message.NO_DATA_FOUND);

				const updatedTour = await this.tourModel
					.findOneAndUpdate(
						{
							_id: booking.tourId,
							tourStatus: { $in: [TourStatus.ACTIVE, TourStatus.SOLD_OUT, TourStatus.CANCELLED] },
							tourBookingCount: { $gte: 1 },
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

				const refundedAt = new Date();
				const refundedBooking = await this.bookingModel
					.findOneAndUpdate(
						{
							_id: booking._id,
							bookingStatus: BookingStatus.CONFIRMED,
							paymentStatus: PaymentStatus.PAID,
						},
						{
							$set: {
								bookingStatus: BookingStatus.CANCELLED,
								paymentStatus: PaymentStatus.REFUNDED,
								refundReference: this.generateRefundReference(),
								refundReason,
								refundedAt,
								cancelledAt: refundedAt,
							},
						},
						{ new: true, runValidators: true, session },
					)
					.lean<Booking>()
					.exec();
				if (!refundedBooking) throw new ConflictException(Message.UPDATE_FAILED);

				return refundedBooking;
			});

			if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
			return result;
		} catch (error: unknown) {
			if (
				error instanceof BadRequestException ||
				error instanceof ConflictException ||
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

	public async completeBooking(agentId: string, bookingId: string): Promise<Booking> {
		if (!isValidObjectId(agentId) || !isValidObjectId(bookingId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberService.getMember(agentId);
		if (member.memberType !== MemberType.AGENT) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const booking = await this.bookingModel
			.findOne({
				_id: bookingId,
				agentId: new Types.ObjectId(agentId),
				bookingStatus: BookingStatus.CONFIRMED,
				paymentStatus: PaymentStatus.PAID,
			})
			.lean<BookingDocumentShape>()
			.exec();
		if (!booking) throw new NotFoundException(Message.NO_DATA_FOUND);

		let selectedEndDate = booking.selectedEndDate;
		if (!selectedEndDate) {
			const tour = await this.tourModel.findById(booking.tourId).lean<TourDocumentShape>().exec();
			const selectedTourDate = tour?.tourAvailableDates.find((tourDate) => tourDate._id.equals(booking.tourDateId));
			if (!selectedTourDate) throw new NotFoundException(Message.NO_DATA_FOUND);
			selectedEndDate = selectedTourDate.endDate;
		}
		if (selectedEndDate.getTime() > Date.now()) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		try {
			const completedBooking = await this.bookingModel
				.findOneAndUpdate(
					{
						_id: booking._id,
						agentId: new Types.ObjectId(agentId),
						bookingStatus: BookingStatus.CONFIRMED,
						paymentStatus: PaymentStatus.PAID,
					},
					{
						$set: {
							bookingStatus: BookingStatus.COMPLETED,
							selectedEndDate,
							completedAt: new Date(),
						},
					},
					{ new: true, runValidators: true },
				)
				.lean<Booking>()
				.exec();

			if (!completedBooking) throw new ConflictException(Message.UPDATE_FAILED);
			return completedBooking;
		} catch (error: unknown) {
			if (
				error instanceof BadRequestException ||
				error instanceof ConflictException ||
				error instanceof NotFoundException
			) {
				throw error;
			}
			if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError')) {
				throw new BadRequestException(Message.BAD_REQUEST);
			}
			throw new InternalServerErrorException(Message.UPDATE_FAILED);
		}
	}

	private async aggregateBookings(
		match: Record<string, unknown>,
		input: MyBookingsInquiry | AgentBookingsInquiry | AllBookingsInquiry,
		memberLookups: Array<{
			localField: 'agentId' | 'userId';
			dataField: 'agentData' | 'userData';
		}>,
	): Promise<Bookings> {
		const sortField = input.sort ?? 'createdAt';
		const sortDirection = input.direction ?? Direction.DESC;
		const memberStages = memberLookups.flatMap(({ localField, dataField }) => [
			{
				$lookup: {
					from: 'members',
					localField,
					foreignField: '_id',
					as: dataField,
				},
			},
			{ $unwind: { path: `$${dataField}`, preserveNullAndEmptyArrays: true } },
			{
				$unset: [
					`${dataField}.memberPassword`,
					`${dataField}.memberEmail`,
					`${dataField}.memberPhone`,
					`${dataField}.memberPhoneCountryCode`,
					`${dataField}.memberAddress`,
				],
			},
		]);
		const [result] = await this.bookingModel
			.aggregate<Bookings>([
				{ $match: match },
				{ $sort: { [sortField]: sortDirection } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{
								$lookup: {
									from: 'tours',
									localField: 'tourId',
									foreignField: '_id',
									as: 'tourData',
								},
							},
							{ $unwind: { path: '$tourData', preserveNullAndEmptyArrays: true } },
							...memberStages,
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		return result ?? { list: [], metaCounter: [] };
	}

	private generateBookingCode(): string {
		return `TL-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.toUpperCase();
	}

	private generatePaymentReference(): string {
		return `PAY-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.toUpperCase();
	}

	private generateRefundReference(): string {
		return `REF-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.toUpperCase();
	}

	private isDuplicateKeyError(error: unknown): boolean {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
	}
}
