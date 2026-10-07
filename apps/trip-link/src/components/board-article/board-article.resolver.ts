import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BoardArticle, BoardArticles } from '../../libs/dto/board-article/board-article';
import {
	AllBoardArticlesInquiry,
	BoardArticleInput,
	BoardArticlesInquiry,
} from '../../libs/dto/board-article/board-article.input';
import { BoardArticleUpdate } from '../../libs/dto/board-article/board-article.update';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { BoardArticleService } from './board-article.service';

@Resolver()
export class BoardArticleResolver {
	constructor(private readonly articles: BoardArticleService) {}

	@Roles(MemberType.AGENT, MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => BoardArticle)
	createBoardArticle(
		@Args('input') input: BoardArticleInput,
		@AuthMember('sub') memberId: string,
	): Promise<BoardArticle> {
		return this.articles.createBoardArticle(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => BoardArticle)
	getBoardArticle(@Args('articleId') articleId: string, @AuthMember('sub') memberId?: string): Promise<BoardArticle> {
		return this.articles.getBoardArticle(articleId, memberId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => BoardArticles)
	getBoardArticles(
		@Args('input') input: BoardArticlesInquiry,
		@AuthMember('sub') memberId?: string,
	): Promise<BoardArticles> {
		return this.articles.getBoardArticles(input, memberId);
	}

	@Roles(MemberType.AGENT, MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => BoardArticle)
	updateBoardArticle(
		@Args('input') input: BoardArticleUpdate,
		@AuthMember('sub') memberId: string,
	): Promise<BoardArticle> {
		return this.articles.updateBoardArticle(input, memberId);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => BoardArticle)
	likeTargetBoardArticle(
		@Args('articleId') articleId: string,
		@AuthMember('sub') memberId: string,
	): Promise<BoardArticle> {
		return this.articles.likeTargetBoardArticle(articleId, memberId);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => BoardArticles)
	getAllBoardArticlesByAdmin(
		@Args('input') input: AllBoardArticlesInquiry,
		@AuthMember('sub') memberId: string,
	): Promise<BoardArticles> {
		return this.articles.getAllBoardArticlesByAdmin(input, memberId);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => BoardArticle)
	updateBoardArticleByAdmin(
		@Args('input') input: BoardArticleUpdate,
		@AuthMember('sub') memberId: string,
	): Promise<BoardArticle> {
		return this.articles.updateBoardArticle(input, memberId, true);
	}
	
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => BoardArticle)
	removeBoardArticleByAdmin(@Args('articleId') articleId: string): Promise<BoardArticle> {
		return this.articles.removeBoardArticleByAdmin(articleId);
	}
}
