import { Type } from 'class-transformer';
import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsDate,
	IsEnum,
	IsIn,
	IsInt,
	IsMongoId,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Length,
	Max,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';
import { availableTourSorts } from '../../config';
import { Direction } from '../../enums/common.enum';
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

@InputType()
export class PriceRangeInput {
	@IsNumber()
	@Min(0)
	@Field(() => Float)
	start!: number;

	@IsNumber()
	@Min(0)
	@Field(() => Float)
	end!: number;
}

@InputType()
export class DurationRangeInput {
	@IsInt()
	@Min(1)
	@Max(365)
	@Field(() => Int)
	start!: number;

	@IsInt()
	@Min(1)
	@Max(365)
	@Field(() => Int)
	end!: number;
}

@InputType()
export class DateRangeInput {
	@IsDate()
	@Type(() => Date)
	@Field(() => Date)
	start!: Date;

	@IsDate()
	@Type(() => Date)
	@Field(() => Date)
	end!: Date;
}

@InputType()
export class TourSearch {
	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	agentId?: string;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(30)
	@IsString({ each: true })
	@MaxLength(150, { each: true })
	@Field(() => [String], { nullable: true })
	destinations?: string[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(30)
	@IsString({ each: true })
	@MaxLength(100, { each: true })
	@Field(() => [String], { nullable: true })
	countries?: string[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(30)
	@IsString({ each: true })
	@MaxLength(100, { each: true })
	@Field(() => [String], { nullable: true })
	cities?: string[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(20)
	@IsEnum(TourCategory, { each: true })
	@Field(() => [TourCategory], { nullable: true })
	categories?: TourCategory[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(10)
	@IsEnum(TourDifficulty, { each: true })
	@Field(() => [TourDifficulty], { nullable: true })
	difficulties?: TourDifficulty[];

	@IsOptional()
	@ValidateNested()
	@Type(() => PriceRangeInput)
	@Field(() => PriceRangeInput, { nullable: true })
	priceRange?: PriceRangeInput;

	@IsOptional()
	@ValidateNested()
	@Type(() => DurationRangeInput)
	@Field(() => DurationRangeInput, { nullable: true })
	durationRange?: DurationRangeInput;

	@IsOptional()
	@ValidateNested()
	@Type(() => DateRangeInput)
	@Field(() => DateRangeInput, { nullable: true })
	availableDateRange?: DateRangeInput;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Field(() => Int, { nullable: true })
	minimumAvailableSeats?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(5)
	@Field(() => Float, { nullable: true })
	minimumRating?: number;

	@IsOptional()
	@IsBoolean()
	@Field(() => Boolean, { nullable: true })
	featured?: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(150)
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class ToursInquiry {
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
	@IsIn(availableTourSorts)
	@Field(() => String, { nullable: true })
	sort?: (typeof availableTourSorts)[number];

	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => TourSearch)
	@Field(() => TourSearch)
	search!: TourSearch;
}
