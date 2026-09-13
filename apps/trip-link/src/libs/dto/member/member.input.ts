import { Type } from 'class-transformer';
import { Field, InputType, Int } from '@nestjs/graphql';
import {
	IsEmail,
	IsEnum,
	IsIn,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Length,
	Max,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';
import { availableAgentSorts } from '../../config';
import { Direction } from '../../enums/common.enum';
import { MemberAuthType, MemberType } from '../../enums/member.enum';

@InputType()
export class MemberInput {
	@IsString()
	@IsNotEmpty()
	@Length(3, 20)
	@Field(() => String)
	memberNick!: string;

	@IsString()
	@IsNotEmpty()
	@Length(8, 72)
	@Field(() => String)
	memberPassword!: string;

	@IsOptional()
	@IsEmail()
	@MaxLength(254)
	@Field(() => String, { nullable: true })
	memberEmail?: string;

	@IsOptional()
	@IsString()
	@Length(7, 20)
	@Field(() => String, { nullable: true })
	memberPhone?: string;

	@IsOptional()
	@IsIn([MemberType.USER, MemberType.AGENT])
	@Field(() => MemberType, { nullable: true })
	memberType?: MemberType;

	@IsOptional()
	@IsEnum(MemberAuthType)
	@Field(() => MemberAuthType, { nullable: true })
	memberAuthType?: MemberAuthType;
}

@InputType()
export class LoginInput {
	@IsString()
	@IsNotEmpty()
	@Length(3, 20)
	@Field(() => String)
	memberNick!: string;

	@IsString()
	@IsNotEmpty()
	@Length(8, 72)
	@Field(() => String)
	memberPassword!: string;
}

@InputType()
export class AgentSearch {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class AgentsInquiry {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(availableAgentSorts)
	@Field(() => String, { nullable: true })
	sort?: (typeof availableAgentSorts)[number];

	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => AgentSearch)
	@Field(() => AgentSearch)
	search!: AgentSearch;
}
