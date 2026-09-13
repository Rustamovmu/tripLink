import { Schema } from 'mongoose';

const DestinationSchema = new Schema(
	{
		destinationName: { type: String, required: true, trim: true },
		destinationSlug: { type: String, required: true, unique: true, lowercase: true, trim: true },
		destinationCountry: { type: String, required: true, trim: true },
		destinationCity: { type: String, trim: true },
		destinationDescription: { type: String, trim: true },
		destinationImages: { type: [String], default: [] },
		destinationFeatured: { type: Boolean, default: false },
		destinationActive: { type: Boolean, default: true },
		destinationTourCount: { type: Number, default: 0, min: 0 },
		coordinates: {
			type: { type: String, enum: ['Point'], default: 'Point' },
			coordinates: { type: [Number], default: undefined },
		},
	},
	{ timestamps: true, collection: 'destinations' },
);

DestinationSchema.index({ coordinates: '2dsphere' });
DestinationSchema.index({ destinationCountry: 1, destinationCity: 1, destinationActive: 1 });

export default DestinationSchema;
