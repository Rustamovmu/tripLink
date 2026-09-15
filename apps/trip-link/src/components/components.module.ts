import { Module } from '@nestjs/common';
import { BookingModule } from './booking/booking.module';
import { FollowModule } from './follow/follow.module';
import { MemberModule } from './member/member.module';
import { ReviewModule } from './review/review.module';
import { TourModule } from './tour/tour.module';

@Module({
	imports: [BookingModule, FollowModule, MemberModule, ReviewModule, TourModule],
})
export class ComponentsModule {}
