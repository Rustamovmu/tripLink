import { Schema } from 'mongoose';

// Quotas and short request leases only. Never store prompts, answers or credentials.
export default new Schema(
	{
		_id: { type: String, required: true },
		count: { type: Number, default: 0 },
		owner: { type: String },
		expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
	},
	{ versionKey: false, collection: 'ai_usage' },
);
