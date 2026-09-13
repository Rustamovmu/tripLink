import { registerEnumType } from '@nestjs/graphql';

export enum TourCategory {
	ADVENTURE = 'ADVENTURE',
	BEACH = 'BEACH',
	CITY = 'CITY',
	CULTURAL = 'CULTURAL',
	FOOD = 'FOOD',
	NATURE = 'NATURE',
	WELLNESS = 'WELLNESS',
	WILDLIFE = 'WILDLIFE',
}
registerEnumType(TourCategory, {
	name: 'TourCategory',
});

export enum TourDifficulty {
	EASY = 'EASY',
	MODERATE = 'MODERATE',
	CHALLENGING = 'CHALLENGING',
}
registerEnumType(TourDifficulty, {
	name: 'TourDifficulty',
});

export enum TourStatus {
	DRAFT = 'DRAFT',
	PENDING = 'PENDING',
	ACTIVE = 'ACTIVE',
	SOLD_OUT = 'SOLD_OUT',
	COMPLETED = 'COMPLETED',
	CANCELLED = 'CANCELLED',
}
registerEnumType(TourStatus, {
	name: 'TourStatus',
});
