import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import CommentSchema from '../../schemas/Comment.model';
import BoardArticleSchema from '../../schemas/BoardArticle.model';
import { AuthModule } from '../auth/auth.module';
import { CommentResolver } from './comment.resolver';
import { CommentService } from './comment.service';

@Module({
	imports: [
		AuthModule,
		MongooseModule.forFeature([
			{ name: 'Comment', schema: CommentSchema },
			{ name: 'BoardArticle', schema: BoardArticleSchema },
		]),
	],
	providers: [CommentResolver, CommentService],
})
export class CommentModule {}
