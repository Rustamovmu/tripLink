import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AiChatInput } from '../../libs/dto/ai/ai-chat.input';
import { AiChatResult } from '../../libs/dto/ai/ai-chat';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { AiService } from './ai.service';

@Resolver()
export class AiResolver {
	constructor(private readonly ai: AiService) {}
	@UseGuards(AuthGuard)
	@Mutation(() => AiChatResult)
	aiChat(@Args('input') input: AiChatInput, @AuthMember('sub') memberId: string): Promise<AiChatResult> {
		return this.ai.chat(memberId, input);
	}
}
