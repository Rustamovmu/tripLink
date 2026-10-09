import { HelpCenterModule } from './help-center/help-center.module';
import { Module } from '@nestjs/common';
import { SocketModule } from '../socket/socket.module';
import { BoardArticleModule } from './board-article/board-article.module';
import { CommentModule } from './comment/comment.module';
import { BookingModule } from './booking/booking.module';
import { FollowModule } from './follow/follow.module';
import { MemberModule } from './member/member.module';
import { ReviewModule } from './review/review.module';
import { TourModule } from './tour/tour.module';

@Module({
	imports: [
		HelpCenterModule,
		SocketModule,
		CommentModule,
		BoardArticleModule,
		BookingModule,
		FollowModule,
		MemberModule,
		ReviewModule,
		TourModule,
	],
})
export class ComponentsModule {}
