import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import BookingSchema from '../../schemas/Booking.model';
import TourSchema from '../../schemas/Tour.model';
import { AuthModule } from '../auth/auth.module';
import { MemberModule } from '../member/member.module';
import { BookingResolver } from './booking.resolver';
import { BookingService } from './booking.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Booking', schema: BookingSchema },
			{ name: 'Tour', schema: TourSchema },
		]),
		AuthModule,
		MemberModule,
	],
	providers: [BookingResolver, BookingService],
	exports: [BookingService],
})
export class BookingModule {}
