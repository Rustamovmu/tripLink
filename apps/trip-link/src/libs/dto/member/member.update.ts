import { Type } from 'class-transformer';
import { Field, InputType } from '@nestjs/graphql';
import {
	ArrayMaxSize,
	IsArray,
	IsEnum,
	IsMongoId,
	IsNotEmpty,
	IsOptional,
	IsString,
	Length,
	MaxLength,
	ValidateIf,
	ValidateNested,
} from 'class-validator';
import { MemberStatus, MemberType } from '../../enums/member.enum';

@InputType()
export class PasswordChangeInput {
	@IsString()
	@IsNotEmpty()
	@Length(8, 72)
	@Field(() => String)
	currentPassword!: string;

	@IsString()
	@IsNotEmpty()
	@Length(8, 72)
	@Field(() => String)
	newPassword!: string;
}

@InputType()
export class MemberUpdate {
	@IsOptional()
	@ValidateNested()
	@Type(() => PasswordChangeInput)
	@Field(() => PasswordChangeInput, { nullable: true })
	passwordChange?: PasswordChangeInput;

	@IsOptional()
	@IsString()
	@Length(3, 20)
	@Field(() => String, { nullable: true })
	memberNick?: string;

	@IsOptional()
	@IsString()
	@Length(2, 100)
	@Field(() => String, { nullable: true })
	memberFullname?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	@Field(() => String, { nullable: true })
	memberImage?: string;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Field(() => String, { nullable: true })
	memberCountry?: string;

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	@Field(() => String, { nullable: true })
	memberDesc?: string;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(100, { each: true })
	@Field(() => [String], { nullable: true })
	memberFavoriteDestinations?: string[];
}

@InputType()
export class MemberAdminUpdate {
	@IsMongoId()
	@Field(() => String)
	memberId!: string;

	@ValidateIf((_object, value) => value !== undefined)
	@IsEnum(MemberType)
	@Field(() => MemberType, { nullable: true })
	memberType?: MemberType;

	@ValidateIf((_object, value) => value !== undefined)
	@IsEnum(MemberStatus)
	@Field(() => MemberStatus, { nullable: true })
	memberStatus?: MemberStatus;

	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@Length(3, 20)
	@Field(() => String, { nullable: true })
	memberNick?: string;

	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@Length(2, 100)
	@Field(() => String, { nullable: true })
	memberFullname?: string;

	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(500)
	@Field(() => String, { nullable: true })
	memberImage?: string;

	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(100)
	@Field(() => String, { nullable: true })
	memberCountry?: string;

	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(1000)
	@Field(() => String, { nullable: true })
	memberDesc?: string;

	@ValidateIf((_object, value) => value !== undefined)
	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(100, { each: true })
	@Field(() => [String], { nullable: true })
	memberFavoriteDestinations?: string[];
}
