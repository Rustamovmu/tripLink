import { Schema } from 'mongoose';
import { TourCategory, TourDifficulty, TourStatus } from '../libs/enums/tour.enum';

const TourDateSchema = new Schema(
	{
		startDate: { type: Date, required: true },
		endDate: { type: Date, required: true },
		availableSeats: { type: Number, required: true, min: 0 },
	},
	{ _id: true },
);

const ItineraryItemSchema = new Schema(
	{
		day: { type: Number, required: true, min: 1 },
		title: { type: String, required: true, trim: true },
		description: { type: String, required: true, trim: true },
	},
	{ _id: false },
);

const TourSchema = new Schema(
	{
		tourTitle: { type: String, required: true, trim: true },
		tourSlug: { type: String, required: true, unique: true, lowercase: true, trim: true },
		tourDescription: { type: String, required: true, trim: true },
		tourDestination: { type: String, required: true, trim: true },
		tourCountry: { type: String, required: true, trim: true },
		tourCity: { type: String, required: true, trim: true },
		tourImages: { type: [String], default: [] },
		tourPrice: { type: Number, required: true, min: 0 },
		tourDiscountPrice: { type: Number, min: 0 },
		tourDurationDays: { type: Number, required: true, min: 1 },
		tourAvailableDates: { type: [TourDateSchema], default: [] },
		tourAvailableSeats: { type: Number, required: true, min: 0 },
		tourMaxGroupSize: { type: Number, required: true, min: 1 },
		tourCategory: { type: String, enum: TourCategory, required: true },
		tourDifficulty: { type: String, enum: TourDifficulty, required: true },
		tourLanguages: { type: [String], default: [] },
		tourTransportation: { type: [String], default: [] },
		tourAccommodation: { type: String, trim: true },
		tourMeals: { type: [String], default: [] },
		tourItinerary: { type: [ItineraryItemSchema], default: [] },
		tourIncludedServices: { type: [String], default: [] },
		tourExcludedServices: { type: [String], default: [] },
		tourAverageRating: { type: Number, default: 0, min: 0, max: 5 },
		tourReviewCount: { type: Number, default: 0, min: 0 },
		tourBookingCount: { type: Number, default: 0, min: 0 },
		tourViewCount: { type: Number, default: 0, min: 0 },
		tourFavoriteCount: { type: Number, default: 0, min: 0 },
		tourStatus: { type: String, enum: TourStatus, default: TourStatus.DRAFT },
		tourFeatured: { type: Boolean, default: false },
		agentId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		deletedAt: { type: Date },
	},
	{ timestamps: true, collection: 'tours' },
);

TourSchema.index({ agentId: 1, tourStatus: 1, createdAt: -1 });
TourSchema.index({ tourCountry: 1, tourCity: 1, tourStatus: 1 });
TourSchema.index({ tourPrice: 1, tourAverageRating: -1 });
TourSchema.index({ tourTitle: 'text', tourDestination: 'text', tourCountry: 'text', tourCity: 'text' });

export default TourSchema;
