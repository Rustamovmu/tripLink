import { Schema } from 'mongoose';

const FollowSchema = new Schema(
	{
		agentId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		followerId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},
	},
	{ timestamps: true, collection: 'follows' },
);

FollowSchema.index({ agentId: 1, followerId: 1 }, { unique: true });
FollowSchema.index({ followerId: 1, createdAt: -1 });

export default FollowSchema;
