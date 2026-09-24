import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import FollowSchema from '../../schemas/Follow.model';
import MemberSchema from '../../schemas/Member.model';
import ReviewSchema from '../../schemas/Review.model';
import TourSchema from '../../schemas/Tour.model';
import { MemberResolver } from './member.resolver';
import { MemberService } from './member.service';
import { AuthModule } from '../auth/auth.module';
import { LikeModule } from '../like/like.module';
import { UploadModule } from '../upload/upload.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Member', schema: MemberSchema },
			{ name: 'Follow', schema: FollowSchema },
			{ name: 'Review', schema: ReviewSchema },
			{ name: 'Tour', schema: TourSchema },
		]),
		AuthModule,
		LikeModule,
		UploadModule,
	],
	providers: [MemberResolver, MemberService],
	exports: [MemberService],
})
export class MemberModule {}
