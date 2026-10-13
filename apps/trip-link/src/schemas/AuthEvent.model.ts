import { Schema } from 'mongoose';
const schema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, index: true },
		action: { type: String, required: true },
		provider: { type: String, enum: ['GOOGLE', 'TELEGRAM', 'KAKAO'] },
		expiresAt: { type: Date, required: true },
	},
	{ timestamps: true, collection: 'authEvents' },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default schema;
