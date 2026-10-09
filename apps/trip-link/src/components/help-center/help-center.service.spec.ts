import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HelpCenterService } from './help-center.service';
import { NoticeCategory, NoticeStatus, FaqTopic } from '../../libs/enums/notice.enum';

describe('Help Center business rules', () => {
	const id = '000000000000000000000001';
	const exec = jest.fn();
	const model = {
		create: jest.fn(),
		findOne: jest.fn(() => ({ lean: () => ({ exec }) })),
		findOneAndUpdate: jest.fn(() => ({ lean: () => ({ exec }) })),
	};
	const service = new HelpCenterService(model as unknown as ConstructorParameters<typeof HelpCenterService>[0]);
	const input = { noticeCategory: NoticeCategory.FAQ, noticeTitle: 'A question', noticeContent: 'An answer' };
	beforeEach(() => jest.clearAllMocks());
	it('requires a topic for FAQs and forbids topics on notices before any write', async () => {
		await expect(service.create(id, input)).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			service.create(id, { ...input, noticeCategory: NoticeCategory.NOTICE, faqTopic: FaqTopic.TOURS }),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(model.create).not.toHaveBeenCalled();
	});
	it('rejects empty updates and null content without a database write', async () => {
		exec.mockResolvedValue({ ...input, faqTopic: FaqTopic.TOURS, noticeStatus: NoticeStatus.HOLD });
		await expect(service.update({ entryId: id })).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			service.update({ entryId: id, noticeTitle: null } as unknown as Parameters<HelpCenterService['update']>[0]),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(model.findOneAndUpdate).not.toHaveBeenCalled();
	});
	it('reports a concurrent hard deletion rather than returning a null success', async () => {
		exec.mockResolvedValueOnce({ ...input, faqTopic: FaqTopic.TOURS }).mockResolvedValueOnce(null);
		await expect(service.update({ entryId: id, noticeTitle: 'Changed question' })).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});
});
