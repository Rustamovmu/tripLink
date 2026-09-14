import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import TourSchema from '../../schemas/Tour.model';
import { AuthModule } from '../auth/auth.module';
import { FavoriteModule } from '../favorite/favorite.module';
import { MemberModule } from '../member/member.module';
import { TourResolver } from './tour.resolver';
import { TourService } from './tour.service';
import { ViewModule } from '../view/view.module';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'Tour', schema: TourSchema }]),
		AuthModule,
		FavoriteModule,
		MemberModule,
		ViewModule,
	],
	providers: [TourResolver, TourService],
	exports: [TourService],
})
export class TourModule {}
