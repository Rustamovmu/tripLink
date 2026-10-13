import { Schema } from 'mongoose';
const schema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, required: true, unique: true },
		revision: { type: Number, default: 0 },
		recoveryEmail: { type: String, select: false },
		emailVerifiedAt: { type: Date },
		recoveryCodeHashes: { type: [String], default: [], select: false },
	},
	{ timestamps: true, collection: 'authSecurity' },
);
schema.index({ recoveryEmail: 1 }, { unique: true, partialFilterExpression: { recoveryEmail: { $type: 'string' } } });
export default schema;
