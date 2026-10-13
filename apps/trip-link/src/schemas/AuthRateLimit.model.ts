import { Schema } from 'mongoose';
const AuthRateLimitSchema = new Schema(
	{
		_id: { type: String, required: true },
		count: { type: Number, required: true },
		expiresAt: { type: Date, required: true },
	},
	{ collection: 'authRateLimits', versionKey: false },
);
AuthRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default AuthRateLimitSchema;
