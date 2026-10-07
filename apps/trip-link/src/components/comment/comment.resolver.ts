import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Comment, Comments } from '../../libs/dto/comment/comment';
import { AllCommentsInquiry, CommentInput, CommentsInquiry } from '../../libs/dto/comment/comment.input';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { CommentService } from './comment.service';

@Resolver()
export class CommentResolver {
	constructor(private readonly comments: CommentService) {}
	@UseGuards(AuthGuard)
	@Mutation(() => Comment)
	createComment(@Args('input') input: CommentInput, @AuthMember('sub') memberId: string): Promise<Comment> {
		return this.comments.createComment(memberId, input);
	}
	@UseGuards(AuthGuard)
	@Mutation(() => Comment)
	updateComment(@Args('input') input: CommentUpdate, @AuthMember('sub') memberId: string): Promise<Comment> {
		return this.comments.updateComment(memberId, input);
	}
	@UseGuards(WithoutGuard)
	@Query(() => Comments)
	getComments(@Args('input') input: CommentsInquiry): Promise<Comments> {
		return this.comments.getComments(input);
	}
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Comments)
	getAllCommentsByAdmin(@Args('input') input: AllCommentsInquiry): Promise<Comments> {
		return this.comments.getComments(input, true);
	}
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Comment)
	updateCommentByAdmin(@Args('input') input: CommentUpdate, @AuthMember('sub') memberId: string): Promise<Comment> {
		return this.comments.updateComment(memberId, input, true);
	}
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Comment)
	removeCommentByAdmin(@Args('commentId') commentId: string): Promise<Comment> {
		return this.comments.removeCommentByAdmin(commentId);
	}
}
