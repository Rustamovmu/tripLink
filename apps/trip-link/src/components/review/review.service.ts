import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, Types } from 'mongoose';
import { ReviewInput, TourReviewsInquiry } from '../../libs/dto/review/review.input';
import { Review, Reviews } from '../../libs/dto/review/review';
import { ReviewUpdate } from '../../libs/dto/review/review.update';
import { BookingStatus, PaymentStatus } from '../../libs/enums/booking.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { ReviewStatus } from '../../libs/enums/review.enum';
import { TourStatus } from '../../libs/enums/tour.enum';
import { MemberService } from '../member/member.service';

type ReviewDocumentShape = Omit<Review, '_id' | 'bookingId' | 'userId' | 'tourId' | 'agentId'> & {
	_id: Types.ObjectId;
	bookingId: Types.ObjectId;
	userId: Types.ObjectId;
	tourId: Types.ObjectId;
	agentId: Types.ObjectId;
};

type ReviewBookingShape = {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	tourId: Types.ObjectId;
	agentId: Types.ObjectId;
	bookingStatus: BookingStatus;
	paymentStatus: PaymentStatus;
};

type TourReviewStatsShape = {
	_id: Types.ObjectId;
	tourAverageRating: number;
	tourReviewCount: number;
};

type ReviewRatingStats = {
	_id: null;
	averageRating: number;
	reviewCount: number;
};

@Injectable()
export class ReviewService {
	constructor(
		@InjectModel('Review') private readonly reviewModel: Model<ReviewDocumentShape>,
		@InjectModel('Booking') private readonly bookingModel: Model<ReviewBookingShape>,
		@InjectModel('Tour') private readonly tourModel: Model<TourReviewStatsShape>,
		private readonly memberService: MemberService,
	) {}

	public async createReview(userId: string, input: ReviewInput): Promise<Review> {
		if (!isValidObjectId(userId) || !isValidObjectId(input.bookingId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
		const reviewComment = input.reviewComment.trim();
		if (reviewComment.length < 3) throw new BadRequestException(Message.BAD_REQUEST);

		const member = await this.memberService.getMember(userId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const session = await this.reviewModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<Review> => {
				const booking = await this.bookingModel
					.findOne({
						_id: input.bookingId,
						userId: new Types.ObjectId(userId),
						bookingStatus: BookingStatus.COMPLETED,
						paymentStatus: PaymentStatus.PAID,
					})
					.session(session)
					.lean<ReviewBookingShape>()
					.exec();
				if (!booking) throw new NotFoundException(Message.NO_DATA_FOUND);

				const tour = await this.tourModel.findById(booking.tourId).session(session).lean<TourReviewStatsShape>().exec();
				if (!tour) throw new NotFoundException(Message.NO_DATA_FOUND);

				const [createdReview] = await this.reviewModel.create(
					[
						{
							bookingId: booking._id,
							userId: booking.userId,
							tourId: booking.tourId,
							agentId: booking.agentId,
							reviewRating: input.reviewRating,
							reviewComment,
							reviewStatus: ReviewStatus.ACTIVE,
						},
					],
					{ session },
				);

				const reviewCount = tour.tourReviewCount + 1;
				const averageRating = Number(
					((tour.tourAverageRating * tour.tourReviewCount + input.reviewRating) / reviewCount).toFixed(2),
				);
				const updatedTour = await this.tourModel
					.updateOne(
						{
							_id: booking.tourId,
							tourReviewCount: tour.tourReviewCount,
							tourAverageRating: tour.tourAverageRating,
						},
						{
							$set: { tourAverageRating: averageRating },
							$inc: { tourReviewCount: 1 },
						},
						{ session, runValidators: true },
					)
					.exec();
				if (updatedTour.matchedCount === 0) throw new ConflictException(Message.UPDATE_FAILED);

				await this.memberService.increaseMemberReviewCount(userId, session);
				return createdReview.toObject() as unknown as Review;
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

	public async getTourReviews(input: TourReviewsInquiry): Promise<Reviews> {
		if (!isValidObjectId(input.search.tourId)) throw new BadRequestException(Message.BAD_REQUEST);

		const tourId = new Types.ObjectId(input.search.tourId);
		const publicTour = await this.tourModel
			.exists({ _id: tourId, tourStatus: { $in: [TourStatus.ACTIVE, TourStatus.SOLD_OUT] } })
			.exec();
		if (!publicTour) throw new NotFoundException(Message.NO_DATA_FOUND);

		const match: Record<string, unknown> = { tourId, reviewStatus: ReviewStatus.ACTIVE };
		if (input.search.reviewRating !== undefined) match.reviewRating = input.search.reviewRating;
		const sortField = input.sort ?? 'createdAt';
		const sortDirection = input.direction ?? Direction.DESC;

		const [result] = await this.reviewModel
			.aggregate<Reviews>([
				{ $match: match },
				{ $sort: { [sortField]: sortDirection } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{
								$lookup: {
									from: 'members',
									localField: 'userId',
									foreignField: '_id',
									as: 'userData',
								},
							},
							{ $unwind: { path: '$userData', preserveNullAndEmptyArrays: true } },
							{
								$unset: [
									'userData.memberPassword',
									'userData.memberEmail',
									'userData.memberPhone',
									'userData.memberPhoneCountryCode',
									'userData.memberAddress',
								],
							},
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		return result ?? { list: [], metaCounter: [] };
	}

	public async updateReview(userId: string, input: ReviewUpdate): Promise<Review> {
		if (
			!isValidObjectId(userId) ||
			!isValidObjectId(input.reviewId) ||
			Object.values(input).some((value) => value === null)
		) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}
		if (input.reviewRating === undefined && input.reviewComment === undefined) {
			throw new BadRequestException(Message.NO_UPDATE_FIELDS);
		}

		const reviewComment = input.reviewComment?.trim();
		if (reviewComment !== undefined && (reviewComment.length < 3 || reviewComment.length > 2000)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberService.getMember(userId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const session = await this.reviewModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<Review> => {
				const existingReview = await this.reviewModel
					.findOne({
						_id: input.reviewId,
						userId: new Types.ObjectId(userId),
						reviewStatus: ReviewStatus.ACTIVE,
					})
					.session(session)
					.lean<ReviewDocumentShape>()
					.exec();
				if (!existingReview) throw new NotFoundException(Message.NO_DATA_FOUND);

				const update: Partial<Pick<Review, 'reviewRating' | 'reviewComment'>> = {};
				if (input.reviewRating !== undefined) update.reviewRating = input.reviewRating;
				if (reviewComment !== undefined) update.reviewComment = reviewComment;

				const updatedReview = await this.reviewModel
					.findOneAndUpdate(
						{
							_id: existingReview._id,
							userId: new Types.ObjectId(userId),
							reviewStatus: ReviewStatus.ACTIVE,
						},
						{ $set: update },
						{ new: true, runValidators: true, session },
					)
					.lean<Review>()
					.exec();
				if (!updatedReview) throw new ConflictException(Message.UPDATE_FAILED);

				if (input.reviewRating !== undefined && input.reviewRating !== existingReview.reviewRating) {
					await this.syncTourReviewStats(existingReview.tourId, session);
				}

				return updatedReview;
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

	public async removeReview(userId: string, reviewId: string): Promise<Review> {
		if (!isValidObjectId(userId) || !isValidObjectId(reviewId)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		const member = await this.memberService.getMember(userId);
		if (member.memberType !== MemberType.USER) throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);

		const session = await this.reviewModel.db.startSession();
		try {
			const result = await session.withTransaction(async (): Promise<Review> => {
				const removedReview = await this.reviewModel
					.findOneAndUpdate(
						{
							_id: reviewId,
							userId: new Types.ObjectId(userId),
							reviewStatus: ReviewStatus.ACTIVE,
						},
						{
							$set: {
								reviewStatus: ReviewStatus.DELETE,
								deletedAt: new Date(),
							},
						},
						{ new: true, runValidators: true, session },
					)
					.lean<ReviewDocumentShape>()
					.exec();
				if (!removedReview) throw new NotFoundException(Message.NO_DATA_FOUND);

				await this.syncTourReviewStats(removedReview.tourId, session);
				await this.memberService.decreaseMemberReviewCount(userId, session);
				return removedReview as unknown as Review;
			});

			if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);
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
			throw new InternalServerErrorException(Message.REMOVE_FAILED);
		} finally {
			await session.endSession();
		}
	}

	private async syncTourReviewStats(tourId: Types.ObjectId, session: ClientSession): Promise<void> {
		const [ratingStats] = await this.reviewModel
			.aggregate<ReviewRatingStats>([
				{ $match: { tourId, reviewStatus: ReviewStatus.ACTIVE } },
				{
					$group: {
						_id: null,
						averageRating: { $avg: '$reviewRating' },
						reviewCount: { $sum: 1 },
					},
				},
			])
			.session(session)
			.exec();

		const updatedTour = await this.tourModel
			.updateOne(
				{ _id: tourId },
				{
					$set: {
						tourAverageRating: ratingStats ? Number(ratingStats.averageRating.toFixed(2)) : 0,
						tourReviewCount: ratingStats?.reviewCount ?? 0,
					},
				},
				{ session, runValidators: true },
			)
			.exec();
		if (updatedTour.matchedCount === 0) throw new ConflictException(Message.UPDATE_FAILED);
	}

	private isDuplicateKeyError(error: unknown): boolean {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
	}
}
