import { Field, InputType } from '@nestjs/graphql';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';

@InputType()
export class MemberUpdate {
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
