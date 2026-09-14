import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import FavoriteSchema from '../../schemas/Favorite.model';
import { FavoriteService } from './favorite.service';

@Module({
	imports: [MongooseModule.forFeature([{ name: 'Favorite', schema: FavoriteSchema }])],
	providers: [FavoriteService],
	exports: [FavoriteService],
})
export class FavoriteModule {}
