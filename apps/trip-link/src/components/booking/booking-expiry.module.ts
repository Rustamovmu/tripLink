import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import BookingSchema from '../../schemas/Booking.model';
import TourSchema from '../../schemas/Tour.model';
import { BookingExpiryService } from './booking-expiry.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Booking', schema: BookingSchema },
			{ name: 'Tour', schema: TourSchema },
		]),
	],
	providers: [BookingExpiryService],
	exports: [BookingExpiryService],
})
export class BookingExpiryModule {}
