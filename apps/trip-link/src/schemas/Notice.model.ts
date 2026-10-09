import { Schema } from 'mongoose';
import { FaqTopic, NoticeCategory, NoticeStatus } from '../libs/enums/notice.enum';

const NoticeSchema = new Schema(
	{
		noticeCategory: {
			type: String,
			enum: NoticeCategory,
			required: true,
		},

		noticeStatus: {
			type: String,
			enum: NoticeStatus,
			default: NoticeStatus.HOLD,
		},

		faqTopic: { type: String, enum: FaqTopic },
		noticeTitle: {
			type: String,
			required: true,
			trim: true,
			minlength: 3,
			maxlength: 150,
		},

		noticeContent: {
			type: String,
			trim: true,
			minlength: 3,
			maxlength: 10000,
			required: true,
		},

		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},
	},
	{ timestamps: true, collection: 'notices' },
);

NoticeSchema.index({ noticeCategory: 1, noticeStatus: 1, faqTopic: 1, createdAt: 1, _id: 1 });
export default NoticeSchema;
