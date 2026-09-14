import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from 'mongoose';
import { TourCategory, TourDifficulty, TourStatus } from '../../enums/tour.enum';
import { Member, TotalCounter } from '../member/member';

@ObjectType()
export class TourDate {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => Date)
	startDate!: Date;

	@Field(() => Date)
	endDate!: Date;

	@Field(() => Int)
	availableSeats!: number;
}

@ObjectType()
export class TourItineraryItem {
	@Field(() => Int)
	day!: number;

	@Field(() => String)
	title!: string;

	@Field(() => String)
	description!: string;
}

@ObjectType()
export class Tour {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	tourTitle!: string;

	@Field(() => String)
	tourSlug!: string;

	@Field(() => String)
	tourDescription!: string;

	@Field(() => String)
	tourDestination!: string;

	@Field(() => String)
	tourCountry!: string;

	@Field(() => String)
	tourCity!: string;

	@Field(() => [String])
	tourImages!: string[];

	@Field(() => Float)
	tourPrice!: number;

	@Field(() => Float, { nullable: true })
	tourDiscountPrice?: number;

	@Field(() => Int)
	tourDurationDays!: number;

	@Field(() => [TourDate])
	tourAvailableDates!: TourDate[];

	@Field(() => Int)
	tourAvailableSeats!: number;

	@Field(() => Int)
	tourMaxGroupSize!: number;

	@Field(() => TourCategory)
	tourCategory!: TourCategory;

	@Field(() => TourDifficulty)
	tourDifficulty!: TourDifficulty;

	@Field(() => [String])
	tourLanguages!: string[];

	@Field(() => [String])
	tourTransportation!: string[];

	@Field(() => String, { nullable: true })
	tourAccommodation?: string;

	@Field(() => [String])
	tourMeals!: string[];

	@Field(() => [TourItineraryItem])
	tourItinerary!: TourItineraryItem[];

	@Field(() => [String])
	tourIncludedServices!: string[];

	@Field(() => [String])
	tourExcludedServices!: string[];

	@Field(() => Float)
	tourAverageRating!: number;

	@Field(() => Int)
	tourReviewCount!: number;

	@Field(() => Int)
	tourBookingCount!: number;

	@Field(() => Int)
	tourViewCount!: number;

	@Field(() => Int)
	tourFavoriteCount!: number;

	@Field(() => TourStatus)
	tourStatus!: TourStatus;

	@Field(() => Boolean)
	tourFeatured!: boolean;

	@Field(() => String)
	agentId!: ObjectId;

	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	@Field(() => Member, { nullable: true })
	agentData?: Member;
}

@ObjectType()
export class Tours {
	@Field(() => [Tour])
	list!: Tour[];

	@Field(() => [TotalCounter])
	metaCounter!: TotalCounter[];
}
