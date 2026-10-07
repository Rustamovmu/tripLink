import {
	BadRequestException,
	ConflictException,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingExpiryService } from './booking-expiry.service';

describe('BookingExpiryService (mock transactions)', () => {
	const read = jest.fn();
	const write = jest.fn();
	const restore = jest.fn();
	const reopen = jest.fn();
	const session = { withTransaction: jest.fn(), endSession: jest.fn() };
	const startSession = jest.fn();
	const lean = (exec: jest.Mock) => ({ lean: () => ({ exec }) });
	const bookingModel = { db: { startSession }, findOne: jest.fn(), findOneAndUpdate: jest.fn() };
	const tourModel = { findOneAndUpdate: jest.fn(), updateOne: jest.fn() };
	const cutoff = new Date('2030-01-02');
	let row: {
		_id: Types.ObjectId;
		tourId: Types.ObjectId;
		tourDateId: Types.ObjectId;
		selectedDate: Date;
		bookingStatus: string;
		numberOfPeople: number;
	};
	let service: BookingExpiryService;

	beforeEach(() => {
		jest.resetAllMocks();
		row = {
			_id: new Types.ObjectId(),
			tourId: new Types.ObjectId(),
			tourDateId: new Types.ObjectId(),
			selectedDate: cutoff,
			bookingStatus: 'PENDING',
			numberOfPeople: 2,
		};
		startSession.mockResolvedValue(session);
		session.withTransaction.mockImplementation((callback: () => Promise<unknown>) => callback());
		session.endSession.mockResolvedValue(undefined);
		bookingModel.findOne.mockReturnValue({ session: () => lean(read) });
		bookingModel.findOneAndUpdate.mockReturnValue(lean(write));
		tourModel.findOneAndUpdate.mockReturnValue(lean(restore));
		tourModel.updateOne.mockReturnValue({ exec: reopen });
		read.mockImplementation(() => Promise.resolve(row));
		write.mockResolvedValue({ bookingStatus: 'CANCELLED' });
		restore.mockResolvedValue({ tourStatus: 'ACTIVE' });
		reopen.mockResolvedValue({ modifiedCount: 1 });
		service = new BookingExpiryService(
			bookingModel as unknown as ConstructorParameters<typeof BookingExpiryService>[0],
			tourModel as unknown as ConstructorParameters<typeof BookingExpiryService>[1],
		);
	});

	it('rejects invalid IDs and cutoff values before creating a session', async () => {
		await expect(service.expireBooking('bad')).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.expireBooking(row._id.toHexString(), new Date(NaN))).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(startSession).not.toHaveBeenCalled();
	});
	it('expires a pending booking at the cutoff without changing seats', async () => {
		await expect(service.expireBooking(row._id.toHexString(), cutoff)).resolves.toMatchObject({
			bookingStatus: 'CANCELLED',
		});
		expect(tourModel.findOneAndUpdate).not.toHaveBeenCalled();
		expect(bookingModel.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: row._id, bookingStatus: 'PENDING', paymentStatus: 'UNPAID', selectedDate: { $lte: cutoff } },
			expect.any(Object),
			{ new: true, runValidators: true, session },
		);
		expect(session.endSession).toHaveBeenCalledTimes(1);
	});
	it('rejects future and missing or settled bookings without writes', async () => {
		row.selectedDate = new Date(cutoff.getTime() + 1);
		await expect(service.expireBooking(row._id.toHexString(), cutoff)).rejects.toBeInstanceOf(BadRequestException);
		read.mockResolvedValueOnce(null);
		await expect(service.expireBooking(row._id.toHexString(), cutoff)).rejects.toBeInstanceOf(NotFoundException);
		expect(write).not.toHaveBeenCalled();
		expect(session.endSession).toHaveBeenCalledTimes(2);
	});
	it('restores only the confirmed departure and reopens SOLD_OUT but preserves CANCELLED', async () => {
		row.bookingStatus = 'CONFIRMED';
		restore.mockResolvedValueOnce({ tourStatus: 'SOLD_OUT' }).mockResolvedValueOnce({ tourStatus: 'CANCELLED' });
		await service.expireBooking(row._id.toHexString(), cutoff);
		expect(tourModel.findOneAndUpdate).toHaveBeenCalledWith(
			expect.any(Object),
			{ $inc: { tourAvailableSeats: 2, 'tourAvailableDates.$[selectedDate].availableSeats': 2, tourBookingCount: -1 } },
			{ new: true, runValidators: true, session, arrayFilters: [{ 'selectedDate._id': row.tourDateId }] },
		);
		expect(reopen).toHaveBeenCalledTimes(1);
		await service.expireBooking(row._id.toHexString(), cutoff);
		expect(reopen).toHaveBeenCalledTimes(1);
	});
	it('rejects inconsistent tour restoration before cancelling the booking', async () => {
		row.bookingStatus = 'CONFIRMED';
		restore.mockResolvedValueOnce(null);
		await expect(service.expireBooking(row._id.toHexString(), cutoff)).rejects.toBeInstanceOf(ConflictException);
		expect(write).not.toHaveBeenCalled();
		expect(session.endSession).toHaveBeenCalledTimes(1);
	});
	it('rejects a lost final conditional write', async () => {
		write.mockResolvedValueOnce(null);
		await expect(service.expireBooking(row._id.toHexString(), cutoff)).rejects.toBeInstanceOf(ConflictException);
		expect(session.endSession).toHaveBeenCalledTimes(1);
	});
	it('keeps database failures as server errors and releases acquired sessions', async () => {
		read.mockRejectedValueOnce(new Error('database unavailable'));
		await expect(service.expireBooking(row._id.toHexString(), cutoff)).rejects.toBeInstanceOf(
			InternalServerErrorException,
		);
		expect(session.endSession).toHaveBeenCalledTimes(1);
		const error = new Error('session unavailable');
		startSession.mockRejectedValueOnce(error);
		await expect(service.expireBooking(row._id.toHexString(), cutoff)).rejects.toBe(error);
	});
});
