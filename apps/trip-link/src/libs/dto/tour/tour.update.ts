import { Field, InputType, PartialType } from '@nestjs/graphql';
import { IsBoolean, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { TourStatus } from '../../enums/tour.enum';
import { TourInput } from './tour.input';

@InputType()
export class TourUpdate extends PartialType(TourInput) {
	@IsMongoId()
	@Field(() => String)
	tourId!: string;

	@IsOptional()
	@IsEnum(TourStatus)
	@Field(() => TourStatus, { nullable: true })
	tourStatus?: TourStatus;
}

@InputType()
export class TourAdminUpdate {
	@IsMongoId()
	@Field(() => String)
	tourId!: string;

	@IsOptional()
	@IsEnum(TourStatus)
	@Field(() => TourStatus, { nullable: true })
	tourStatus?: TourStatus;

	@IsOptional()
	@IsBoolean()
	@Field(() => Boolean, { nullable: true })
	tourFeatured?: boolean;
}
