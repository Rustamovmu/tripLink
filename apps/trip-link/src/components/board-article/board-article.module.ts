import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import BoardArticleSchema from '../../schemas/BoardArticle.model';
import CommentSchema from '../../schemas/Comment.model';
import LikeSchema from '../../schemas/Like.model';
import ViewSchema from '../../schemas/View.model';
import { AuthModule } from '../auth/auth.module';
import { LikeModule } from '../like/like.module';
import { ViewModule } from '../view/view.module';
import { BoardArticleResolver } from './board-article.resolver';
import { BoardArticleService } from './board-article.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'BoardArticle', schema: BoardArticleSchema },
			{ name: 'Comment', schema: CommentSchema },
			{ name: 'Like', schema: LikeSchema },
			{ name: 'View', schema: ViewSchema },
		]),
		AuthModule,
		LikeModule,
		ViewModule,
	],
	providers: [BoardArticleResolver, BoardArticleService],
	exports: [BoardArticleService],
})
export class BoardArticleModule {}
