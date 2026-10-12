import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class AiTourSource {
	@Field(() => String) tourId!: string;
	@Field(() => String) title!: string;
	@Field(() => String) destination!: string;
	@Field(() => Float) price!: number;
	@Field(() => Int) durationDays!: number;
	@Field(() => Float) rating!: number;
	@Field(() => Int) reviewCount!: number;
	@Field(() => String) status!: string;
}

@ObjectType()
export class AiChatResult {
	@Field(() => String) text!: string;
	@Field(() => [AiTourSource]) sources!: AiTourSource[];
}
