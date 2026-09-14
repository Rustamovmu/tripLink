import { Schema } from 'mongoose';
import { BookingStatus, PaymentStatus } from '../libs/enums/booking.enum';

const BookingSchema = new Schema(
	{
		bookingCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
		userId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		tourId: { type: Schema.Types.ObjectId, required: true, ref: 'Tour' },
		agentId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		tourDateId: { type: Schema.Types.ObjectId, required: true },
		selectedDate: { type: Date, required: true },
		numberOfPeople: { type: Number, required: true, min: 1 },
		unitPrice: { type: Number, required: true, min: 0 },
		totalPrice: { type: Number, required: true, min: 0 },
		bookingStatus: { type: String, enum: BookingStatus, default: BookingStatus.PENDING },
		paymentStatus: { type: String, enum: PaymentStatus, default: PaymentStatus.UNPAID },
		paymentReference: { type: String, trim: true },
		paidAt: { type: Date },
		refundReference: { type: String, trim: true },
		refundReason: { type: String, trim: true },
		refundedAt: { type: Date },
		cancellationReason: { type: String, trim: true },
		cancelledAt: { type: Date },
		rejectionReason: { type: String, trim: true },
		rejectedAt: { type: Date },
		completedAt: { type: Date },
	},
	{ timestamps: true, collection: 'bookings' },
);

BookingSchema.index({ userId: 1, bookingStatus: 1, selectedDate: 1 });
BookingSchema.index({ agentId: 1, bookingStatus: 1, selectedDate: 1 });
BookingSchema.index({ tourId: 1, selectedDate: 1 });

export default BookingSchema;
