import { Schema } from 'mongoose';
import { MessageStatus } from '../libs/enums/message.enum';

const MessageSchema = new Schema(
	{
		conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
		senderId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		receiverId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		messageText: { type: String, required: true, trim: true },
		messageStatus: { type: String, enum: MessageStatus, default: MessageStatus.SENT },
		messageRead: { type: Boolean, default: false },
		readAt: { type: Date },
		deletedAt: { type: Date },
	},
	{ timestamps: true, collection: 'messages' },
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ receiverId: 1, messageRead: 1, createdAt: -1 });

export default MessageSchema;
