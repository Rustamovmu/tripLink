import { Schema } from 'mongoose';
import { ConversationStatus } from '../libs/enums/conversation.enum';

const ConversationSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		agentId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		conversationStatus: {
			type: String,
			enum: ConversationStatus,
			default: ConversationStatus.ACTIVE,
		},
		lastMessageAt: { type: Date },
		userUnreadCount: { type: Number, default: 0, min: 0 },
		agentUnreadCount: { type: Number, default: 0, min: 0 },
	},
	{ timestamps: true, collection: 'conversations' },
);

ConversationSchema.index({ userId: 1, agentId: 1 }, { unique: true });
ConversationSchema.index({ userId: 1, lastMessageAt: -1 });
ConversationSchema.index({ agentId: 1, lastMessageAt: -1 });

export default ConversationSchema;
