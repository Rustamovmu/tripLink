import { Schema } from 'mongoose';
const schema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, required: true, index: true },
		provider: { type: String, enum: ['GOOGLE', 'TELEGRAM', 'KAKAO'], required: true },
		providerUserId: { type: String, required: true, select: false },
		lastUsedAt: { type: Date },
	},
	{ timestamps: true, collection: 'authIdentities' },
);
schema.index({ provider: 1, providerUserId: 1 }, { unique: true });
schema.index({ memberId: 1, provider: 1 }, { unique: true });
export default schema;
