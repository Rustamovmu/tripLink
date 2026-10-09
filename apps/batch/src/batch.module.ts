import { Module } from '@nestjs/common';
import { BatchController } from './batch.controller';
import { RankingService } from './ranking.service';
import TourSchema from '../../trip-link/src/schemas/Tour.model';
import MemberSchema from '../../trip-link/src/schemas/Member.model';
import { BatchService } from './batch.service';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../trip-link/src/database/database.module';
import BookingSchema from '../../trip-link/src/schemas/Booking.model';
import { BookingExpiryModule } from '../../trip-link/src/components/booking/booking-expiry.module';

@Module({
	imports: [
		ConfigModule.forRoot(),
		DatabaseModule,
		ScheduleModule.forRoot(),
		MongooseModule.forFeature([
			{ name: 'Booking', schema: BookingSchema },
			{ name: 'Tour', schema: TourSchema },
			{ name: 'Member', schema: MemberSchema },
		]),
		BookingExpiryModule,
	],
	controllers: [BatchController],
	providers: [BatchService, RankingService],
})
export class BatchModule {}
