import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
	AgentBookingsInquiry,
	BookingCancellationInput,
	BookingInput,
	BookingRejectionInput,
	MyBookingsInquiry,
} from '../../libs/dto/booking/booking.input';
import { Booking, Bookings } from '../../libs/dto/booking/booking';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BookingService } from './booking.service';

@Resolver()
export class BookingResolver {
	constructor(private readonly bookingService: BookingService) {}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Booking)
	public createBooking(@Args('input') input: BookingInput, @AuthMember('sub') userId: string): Promise<Booking> {
		return this.bookingService.createBooking(userId, input);
	}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Mutation(() => Booking)
	public confirmBooking(@Args('bookingId') bookingId: string, @AuthMember('sub') agentId: string): Promise<Booking> {
		return this.bookingService.confirmBooking(agentId, bookingId);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Booking)
	public cancelBooking(
		@Args('input') input: BookingCancellationInput,
		@AuthMember('sub') userId: string,
	): Promise<Booking> {
		return this.bookingService.cancelBooking(userId, input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Query(() => Bookings)
	public getMyBookings(@Args('input') input: MyBookingsInquiry, @AuthMember('sub') userId: string): Promise<Bookings> {
		return this.bookingService.getMyBookings(userId, input);
	}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Query(() => Bookings)
	public getAgentBookings(
		@Args('input') input: AgentBookingsInquiry,
		@AuthMember('sub') agentId: string,
	): Promise<Bookings> {
		return this.bookingService.getAgentBookings(agentId, input);
	}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Mutation(() => Booking)
	public rejectBooking(
		@Args('input') input: BookingRejectionInput,
		@AuthMember('sub') agentId: string,
	): Promise<Booking> {
		return this.bookingService.rejectBooking(agentId, input);
	}
}
