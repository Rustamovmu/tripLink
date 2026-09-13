import { Schema } from 'mongoose';
import { AgentApprovalStatus } from '../libs/enums/member.enum';

const AgentProfileSchema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, required: true, unique: true, ref: 'Member' },
		agentApprovalStatus: {
			type: String,
			enum: AgentApprovalStatus,
			default: AgentApprovalStatus.PENDING,
		},
		agencyName: { type: String, required: true, trim: true },
		agencyDescription: { type: String, trim: true },
		agencyImage: { type: String },
		agencyEmail: { type: String, lowercase: true, trim: true },
		agencyPhone: { type: String, trim: true },
		agencyWebsite: { type: String, trim: true },
		agencyCountry: { type: String, trim: true },
		agencyCity: { type: String, trim: true },
		agencyAddress: { type: String, trim: true },
		agencyLicenseNumber: { type: String, trim: true },
		agentAverageRating: { type: Number, default: 0, min: 0, max: 5 },
		agentReviewCount: { type: Number, default: 0, min: 0 },
		agentFollowerCount: { type: Number, default: 0, min: 0 },
		agentTourCount: { type: Number, default: 0, min: 0 },
	},
	{ timestamps: true, collection: 'agentProfiles' },
);

AgentProfileSchema.index({ agentApprovalStatus: 1, createdAt: -1 });

export default AgentProfileSchema;
