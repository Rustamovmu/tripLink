import { Type } from 'class-transformer';
import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsMongoId, IsNotEmpty, Max, Min, ValidateNested } from 'class-validator';

@InputType()
export class FollowSearch {
	@IsMongoId()
	@Field(() => String)
	memberId!: string;
}

@InputType()
export class FollowInquiry {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	limit!: number;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => FollowSearch)
	@Field(() => FollowSearch)
	search!: FollowSearch;
}
