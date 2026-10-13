import { Schema } from 'mongoose';
import { MemberType } from '../libs/enums/member.enum';
const RefreshSessionSchema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, required: true },
		memberType: { type: String, enum: MemberType, required: true },
		tokenHash: { type: String, required: true, select: false },
		tokenFamilyId: { type: String, required: true },
		tokenId: { type: String, required: true, select: false },
		issuedAt: { type: Number, required: true, select: false },
		expiresAt: { type: Date, required: true },
		absoluteExpiresAt: { type: Date, required: true },
		revokedAt: { type: Date, default: null },
		lastUsedAt: { type: Date, required: true },
		userAgent: { type: String, default: '' },
		deviceName: { type: String, default: 'Browser' },
		previousTokenHash: { type: String, select: false },
		rotationIdHash: { type: String, select: false },
		retryExpiresAt: { type: Date, select: false },
	},
	{ timestamps: true, collection: 'refreshSessions' },
);
RefreshSessionSchema.index({ memberId: 1, revokedAt: 1, expiresAt: 1 });
// Retain expired/revoked families until their absolute deadline. TTL deletion is cleanup, never authorization.
RefreshSessionSchema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 });
export default RefreshSessionSchema;
