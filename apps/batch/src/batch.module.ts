import { Module } from '@nestjs/common';
import { BatchController } from './batch.controller';
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
		MongooseModule.forFeature([{ name: 'Booking', schema: BookingSchema }]),
		BookingExpiryModule,
	],
	controllers: [BatchController],
	providers: [BatchService],
})
export class BatchModule {}
