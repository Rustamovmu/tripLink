import { Field, InputType } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsIn,
	IsMongoId,
	IsOptional,
	IsString,
	Length,
	ValidateNested,
} from 'class-validator';
import { AI_HISTORY_LIMIT, AI_INTENTS, AI_MESSAGE_LIMIT } from '../../../components/ai/ai.constants';
import { TourSearch } from '../tour/tour.input';

@InputType()
export class AiMessageInput {
	@IsIn(['user', 'assistant'])
	@Field(() => String)
	role!: 'user' | 'assistant';

	@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@Length(1, AI_MESSAGE_LIMIT)
	@Field(() => String)
	text!: string;
}

@InputType()
export class AiChatInput {
	@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@Length(1, AI_MESSAGE_LIMIT)
	@Field(() => String)
	message!: string;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(AI_HISTORY_LIMIT)
	@ValidateNested({ each: true })
	@Type(() => AiMessageInput)
	@Field(() => [AiMessageInput], { nullable: true })
	history?: AiMessageInput[];

	@IsOptional()
	@IsIn(AI_INTENTS)
	@Field(() => String, { nullable: true })
	intent?: (typeof AI_INTENTS)[number];

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	tourId?: string;

	@IsOptional()
	@ValidateNested()
	@Type(() => TourSearch)
	@Field(() => TourSearch, { nullable: true })
	search?: TourSearch;

	@IsOptional()
	@IsBoolean()
	@Field(() => Boolean, { nullable: true })
	detailed?: boolean;
}
