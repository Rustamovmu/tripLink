import { Module } from '@nestjs/common';
import { MemberModule } from './member/member.module';
import { TourModule } from './tour/tour.module';

@Module({
  imports: [MemberModule, TourModule]
})
export class ComponentsModule {}
