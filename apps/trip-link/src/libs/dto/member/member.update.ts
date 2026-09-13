import { Type } from 'class-transformer';
import { Field, InputType } from '@nestjs/graphql';
import {
	ArrayMaxSize,
	IsArray,
	IsNotEmpty,
	IsOptional,
	IsString,
	Length,
	MaxLength,
	ValidateNested,
} from 'class-validator';

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
