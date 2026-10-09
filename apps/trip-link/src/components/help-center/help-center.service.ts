import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { HelpEntry, HelpEntries } from '../../libs/dto/help-center/help-center';
import {
	HelpEntryInput,
	HelpEntriesInquiry,
	AdminHelpEntriesInquiry,
	helpKinds,
	helpStatuses,
} from '../../libs/dto/help-center/help-center.input';
import { HelpEntryUpdate } from '../../libs/dto/help-center/help-center.update';
import { NoticeCategory, NoticeStatus } from '../../libs/enums/notice.enum';
@Injectable()
export class HelpCenterService {
	constructor(@InjectModel('Notice') private readonly notices: Model<HelpEntry>) {}
	private managedMatch() {
		return { noticeCategory: { $in: helpKinds }, noticeStatus: { $in: helpStatuses } };
	}
	private validateId(id: string) {
		if (!isValidObjectId(id)) throw new BadRequestException('Invalid entry ID');
	}
	async create(memberId: string, input: HelpEntryInput): Promise<HelpEntry> {
		this.validateId(memberId);
		if (input.noticeCategory === NoticeCategory.FAQ && !input.faqTopic)
			throw new BadRequestException('FAQ topic is required');
		if (input.noticeCategory === NoticeCategory.NOTICE && input.faqTopic != null)
			throw new BadRequestException('Notices cannot have an FAQ topic');
		return (
			await this.notices.create({
				noticeCategory: input.noticeCategory,
				noticeTitle: input.noticeTitle.trim(),
				noticeContent: input.noticeContent.trim(),
				noticeStatus: input.noticeStatus ?? NoticeStatus.HOLD,
				...(input.noticeCategory === NoticeCategory.FAQ ? { faqTopic: input.faqTopic } : {}),
				memberId,
			})
		).toObject();
	}
	async get(entryId: string): Promise<HelpEntry> {
		this.validateId(entryId);
		const entry = await this.notices
			.findOne({ ...this.managedMatch(), _id: entryId, noticeStatus: NoticeStatus.ACTIVE })
			.lean<HelpEntry>()
			.exec();
		if (!entry) throw new NotFoundException('Help entry not found');
		return entry;
	}
	async list(input: HelpEntriesInquiry | AdminHelpEntriesInquiry, admin = false): Promise<HelpEntries> {
		const search = input.search;
		const status = admin && 'noticeStatus' in search ? search.noticeStatus : undefined;
		const match: Record<string, unknown> = {
			...this.managedMatch(),
			noticeStatus: admin ? (status ?? { $in: helpStatuses }) : NoticeStatus.ACTIVE,
		};
		if (search.noticeCategory) match.noticeCategory = search.noticeCategory;
		if (search.faqTopic) {
			match.faqTopic = search.faqTopic;
			match.noticeCategory = NoticeCategory.FAQ;
		}
		if (search.noticeCategory === NoticeCategory.NOTICE && search.faqTopic)
			throw new BadRequestException('Notices cannot have an FAQ topic');
		if (search.text?.trim()) {
			const expression = new RegExp(search.text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
			match.$or = [{ noticeTitle: expression }, { noticeContent: expression }];
		}
		const direction = search.noticeCategory === NoticeCategory.FAQ || search.faqTopic ? 1 : -1;
		const [result] = await this.notices
			.aggregate<HelpEntries>([
				{ $match: match },
				{ $sort: { createdAt: direction, _id: direction } },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		return result ?? { list: [], metaCounter: [] };
	}
	async update(input: HelpEntryUpdate): Promise<HelpEntry> {
		this.validateId(input.entryId);
		const entry = await this.notices
			.findOne({ ...this.managedMatch(), _id: input.entryId })
			.lean<HelpEntry>()
			.exec();
		if (!entry) throw new NotFoundException('Help entry not found');
		const updates: Partial<HelpEntry> = {};
		for (const key of ['noticeTitle', 'noticeContent'] as const) {
			if (input[key] === null) throw new BadRequestException('Content cannot be null');
			if (input[key] !== undefined) updates[key] = input[key]?.trim();
		}
		if (input.noticeStatus === null) throw new BadRequestException('Status cannot be null');
		if (input.noticeStatus !== undefined) updates.noticeStatus = input.noticeStatus;
		if (input.faqTopic === null) throw new BadRequestException('FAQ topic cannot be null');
		if (input.faqTopic !== undefined) {
			if (entry.noticeCategory !== NoticeCategory.FAQ)
				throw new BadRequestException('Notices cannot have an FAQ topic');
			updates.faqTopic = input.faqTopic;
		}
		if (entry.noticeCategory === NoticeCategory.FAQ && !(updates.faqTopic ?? entry.faqTopic))
			throw new BadRequestException('FAQ topic is required');
		if (!Object.keys(updates).length) throw new BadRequestException('At least one update field is required');
		const updated = await this.notices
			.findOneAndUpdate(
				{ ...this.managedMatch(), _id: input.entryId, noticeCategory: entry.noticeCategory },
				{ $set: updates },
				{ new: true, runValidators: true },
			)
			.lean<HelpEntry>()
			.exec();
		if (!updated) throw new NotFoundException('Help entry not found');
		return updated;
	}
	async remove(entryId: string): Promise<boolean> {
		this.validateId(entryId);
		const result = await this.notices.deleteOne({ ...this.managedMatch(), _id: entryId }).exec();
		if (!result.deletedCount) throw new NotFoundException('Help entry not found');
		return true;
	}
}
