import { Module } from '@nestjs/common';
import { BookingModule } from './booking/booking.module';
import { MemberModule } from './member/member.module';
import { TourModule } from './tour/tour.module';

@Module({
	imports: [BookingModule, MemberModule, TourModule],
})
export class ComponentsModule {}
