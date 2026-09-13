import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';
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
