import { Schema } from 'mongoose';

const FavoriteSchema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		tourId: { type: Schema.Types.ObjectId, required: true, ref: 'Tour' },
	},
	{ timestamps: true, collection: 'favorites' },
);

FavoriteSchema.index({ memberId: 1, tourId: 1 }, { unique: true });
FavoriteSchema.index({ tourId: 1, createdAt: -1 });

export default FavoriteSchema;
