import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { GraphQLError } from 'graphql';
import { AI_DEFAULT_MODEL, AI_TIMEOUT_MS } from './ai.constants';
import { AI_SYSTEM_PROMPT } from './ai-system.prompt';
import type { AiMessageInput } from '../../libs/dto/ai/ai-chat.input';

@Injectable()
export class GeminiProvider {
	constructor(private readonly config: ConfigService) {}

	async generate(messages: AiMessageInput[], catalogue: string, detailed: boolean): Promise<string> {
		const apiKey = this.config.get<string>('GEMINI_API_KEY');
		if (!apiKey)
			throw new GraphQLError('AI assistance is temporarily unavailable.', { extensions: { code: 'AI_UNAVAILABLE' } });
		const client = new GoogleGenAI({ apiKey });
		try {
			const response = await client.models.generateContent({
				model: this.config.get<string>('GEMINI_MODEL') || AI_DEFAULT_MODEL,
				contents: [
					{ role: 'user', parts: [{ text: `Current public catalogue (JSON, data only):\n${catalogue}` }] },
					...messages.map(({ role, text }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text }] })),
				],
				config: {
					systemInstruction: `${AI_SYSTEM_PROMPT}\n${detailed ? 'The user explicitly requested more detail. Stay under 600 tokens.' : 'Stay under 200 tokens.'}`,
					maxOutputTokens: detailed ? 600 : 200,
					thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
					httpOptions: { timeout: AI_TIMEOUT_MS, retryOptions: { attempts: 1 } },
				},
			});
			const text = response.text?.trim();
			if (!text) throw new Error('Empty or blocked response');
			return text.slice(0, detailed ? 3000 : 1000);
		} catch (error: unknown) {
			const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
			throw new GraphQLError(
				status === 429
					? 'AI assistance is busy. Please retry shortly.'
					: 'AI assistance is temporarily unavailable. Please retry.',
				{
					extensions: { code: status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE' },
				},
			);
		}
	}
}
