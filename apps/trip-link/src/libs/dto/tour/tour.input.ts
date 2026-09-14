import { Type } from 'class-transformer';
import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
	ArrayMaxSize,
	IsArray,
	IsDate,
	IsEnum,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	Length,
	Max,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';
import { TourCategory, TourDifficulty } from '../../enums/tour.enum';

@InputType()
export class TourDateInput {
	@IsDate()
	@Type(() => Date)
	@Field(() => Date)
	startDate!: Date;

	@IsDate()
	@Type(() => Date)
	@Field(() => Date)
	endDate!: Date;

	@IsInt()
	@Min(0)
	@Field(() => Int)
	availableSeats!: number;
}

@InputType()
export class TourItineraryItemInput {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	day!: number;

	@IsString()
	@Length(2, 120)
	@Field(() => String)
	title!: string;

	@IsString()
	@Length(5, 2000)
	@Field(() => String)
	description!: string;
}

@InputType()
export class TourInput {
	@IsString()
	@Length(5, 150)
	@Field(() => String)
	tourTitle!: string;

	@IsString()
	@Length(20, 10000)
	@Field(() => String)
	tourDescription!: string;

	@IsString()
	@Length(2, 150)
	@Field(() => String)
	tourDestination!: string;

	@IsString()
	@Length(2, 100)
	@Field(() => String)
	tourCountry!: string;

	@IsString()
	@Length(2, 100)
	@Field(() => String)
	tourCity!: string;

	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(500, { each: true })
	@Field(() => [String])
	tourImages!: string[];

	@IsNumber()
	@Min(0)
	@Field(() => Float)
	tourPrice!: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Field(() => Float, { nullable: true })
	tourDiscountPrice?: number;

	@IsInt()
	@Min(1)
	@Max(365)
	@Field(() => Int)
	tourDurationDays!: number;

	@IsArray()
	@ArrayMaxSize(100)
	@ValidateNested({ each: true })
	@Type(() => TourDateInput)
	@Field(() => [TourDateInput])
	tourAvailableDates!: TourDateInput[];

	@IsInt()
	@Min(0)
	@Field(() => Int)
	tourAvailableSeats!: number;

	@IsInt()
	@Min(1)
	@Field(() => Int)
	tourMaxGroupSize!: number;

	@IsEnum(TourCategory)
	@Field(() => TourCategory)
	tourCategory!: TourCategory;

	@IsEnum(TourDifficulty)
	@Field(() => TourDifficulty)
	tourDifficulty!: TourDifficulty;

	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(100, { each: true })
	@Field(() => [String])
	tourLanguages!: string[];

	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(150, { each: true })
	@Field(() => [String])
	tourTransportation!: string[];

	@IsOptional()
	@IsString()
	@MaxLength(500)
	@Field(() => String, { nullable: true })
	tourAccommodation?: string;

	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(150, { each: true })
	@Field(() => [String])
	tourMeals!: string[];

	@IsArray()
	@ArrayMaxSize(365)
	@ValidateNested({ each: true })
	@Type(() => TourItineraryItemInput)
	@Field(() => [TourItineraryItemInput])
	tourItinerary!: TourItineraryItemInput[];

	@IsArray()
	@ArrayMaxSize(50)
	@IsString({ each: true })
	@MaxLength(200, { each: true })
	@Field(() => [String])
	tourIncludedServices!: string[];

	@IsArray()
	@ArrayMaxSize(50)
	@IsString({ each: true })
	@MaxLength(200, { each: true })
	@Field(() => [String])
	tourExcludedServices!: string[];
}
