import { Schema } from 'mongoose';
import { ReviewStatus } from '../libs/enums/review.enum';

const ReviewSchema = new Schema(
	{
		bookingId: { type: Schema.Types.ObjectId, required: true, unique: true, ref: 'Booking' },
		userId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		tourId: { type: Schema.Types.ObjectId, required: true, ref: 'Tour' },
		agentId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		reviewRating: { type: Number, required: true, min: 1, max: 5 },
		reviewComment: { type: String, required: true, trim: true, minlength: 3, maxlength: 2000 },
		reviewStatus: { type: String, enum: ReviewStatus, default: ReviewStatus.ACTIVE },
		deletedAt: { type: Date },
	},
	{ timestamps: true, collection: 'reviews' },
);

ReviewSchema.index({ tourId: 1, reviewStatus: 1, createdAt: -1 });
ReviewSchema.index({ agentId: 1, reviewStatus: 1, createdAt: -1 });
ReviewSchema.index({ userId: 1, createdAt: -1 });

export default ReviewSchema;
