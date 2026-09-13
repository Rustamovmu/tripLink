import { Schema } from 'mongoose';
import { MemberAuthType, MemberStatus, MemberType } from '../libs/enums/member.enum';

const MemberSchema = new Schema(
	{
		memberType: { type: String, enum: MemberType, default: MemberType.USER },
		memberStatus: { type: String, enum: MemberStatus, default: MemberStatus.ACTIVE },
		memberAuthType: { type: String, enum: MemberAuthType, default: MemberAuthType.EMAIL },
		memberEmail: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
		memberPhone: { type: String, unique: true, sparse: true, trim: true },
		memberNick: { type: String, required: true, unique: true, trim: true },
		memberPassword: { type: String, required: true, select: false },
		memberFullname: { type: String, trim: true },
		memberImage: { type: String, default: '' },
		memberCountry: { type: String, trim: true },
		memberPhoneCountryCode: { type: String, trim: true },
		memberAddress: { type: String, trim: true },
		memberDesc: { type: String, trim: true },
		memberFavoriteDestinations: { type: [String], default: [] },
		memberTours: { type: Number, default: 0, min: 0 },
		memberBookings: { type: Number, default: 0, min: 0 },
		memberReviews: { type: Number, default: 0, min: 0 },
		memberFollowers: { type: Number, default: 0, min: 0 },
		memberFollowings: { type: Number, default: 0, min: 0 },
		memberPoints: { type: Number, default: 0, min: 0 },
		memberLikes: { type: Number, default: 0, min: 0 },
		memberViews: { type: Number, default: 0, min: 0 },
		memberComments: { type: Number, default: 0, min: 0 },
		memberWarnings: { type: Number, default: 0, min: 0 },
		memberBlocks: { type: Number, default: 0, min: 0 },
		lastLoginAt: { type: Date },
		deletedAt: { type: Date },
	},
	{ timestamps: true, collection: 'members' },
);

MemberSchema.index({ memberType: 1, memberStatus: 1, createdAt: -1 });

export default MemberSchema;
