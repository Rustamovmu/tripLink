import { Schema } from 'mongoose';
const schema = new Schema(
	{
		_id: { type: String, required: true },
		kind: { type: String, enum: ['OAUTH', 'ONBOARDING', 'SOCIAL_LOGIN', 'RESET', 'VERIFY'], required: true },
		bindingHash: { type: String, select: false },
		sealed: { type: String, required: true, select: false },
		expiresAt: { type: Date, required: true },
		consumedAt: { type: Date, default: null },
	},
	{ timestamps: true, collection: 'authTransactions' },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default schema;
