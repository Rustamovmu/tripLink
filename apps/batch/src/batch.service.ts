import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { BookingExpiryService } from '../../trip-link/src/components/booking/booking-expiry.service';
import { BookingStatus, PaymentStatus } from '../../trip-link/src/libs/enums/booking.enum';

export const BOOKING_EXPIRY_JOB = 'EXPIRE_UNPAID_BOOKINGS';
export const BOOKING_EXPIRY_PAGE_SIZE = 100;
export const BOOKING_EXPIRY_MAX_PER_PASS = 1000;
type Candidate = { _id: Types.ObjectId; selectedDate: Date };
export type ExpiryPassResult = {
	state: 'completed' | 'disabled' | 'busy' | 'stopping';
	scanned: number;
	expired: number;
	skipped: number;
};

@Injectable()
export class BatchService implements OnModuleDestroy {
	private readonly logger = new Logger(BatchService.name);
	private cursor: Candidate | undefined;
	private currentPass: Promise<ExpiryPassResult> | undefined;
	private stopping = false;

	constructor(
		@InjectModel('Booking') private readonly bookingModel: Model<Candidate>,
		private readonly bookingExpiry: BookingExpiryService,
		private readonly config: ConfigService,
	) {}

	getHello(): string {
		return 'Welcome to the Batch API!';
	}

	@Cron(CronExpression.EVERY_MINUTE, { name: BOOKING_EXPIRY_JOB, timeZone: 'UTC' })
	public async scheduledBookingExpiry(): Promise<void> {
		try {
			await this.runBookingExpiry();
		} catch {
			// No booking/member payloads or credentials are written to logs.
			this.logger.error('Booking expiry pass failed; the next tick will retry from the last completed candidate.');
		}
	}

	public runBookingExpiry(): Promise<ExpiryPassResult> {
		const empty = { scanned: 0, expired: 0, skipped: 0 };
		if (this.stopping) return Promise.resolve({ state: 'stopping', ...empty });
		// Read after ConfigModule loads .env, rather than during decorator evaluation.
		if (this.config.get<string>('BATCH_BOOKING_EXPIRY_ENABLED') !== 'true')
			return Promise.resolve({ state: 'disabled', ...empty });
		if (this.currentPass) return Promise.resolve({ state: 'busy', ...empty });

		const pass = this.expireCandidates(new Date());
		this.currentPass = pass;
		return pass.finally(() => {
			this.currentPass = undefined;
		});
	}

	public async onModuleDestroy(): Promise<void> {
		this.stopping = true;
		// Finish the current transaction before Mongoose connections are closed.
		if (this.currentPass) await this.currentPass.catch(() => undefined);
	}

	private async expireCandidates(cutoff: Date): Promise<ExpiryPassResult> {
		const result: ExpiryPassResult = { state: 'completed', scanned: 0, expired: 0, skipped: 0 };
		while (!this.stopping && result.scanned < BOOKING_EXPIRY_MAX_PER_PASS) {
			const filter: Record<string, unknown> = {
				bookingStatus: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
				paymentStatus: PaymentStatus.UNPAID,
				selectedDate: { $lte: cutoff },
			};
			if (this.cursor)
				filter.$or = [
					{ selectedDate: { $gt: this.cursor.selectedDate } },
					{ selectedDate: this.cursor.selectedDate, _id: { $gt: this.cursor._id } },
				];
			const size = Math.min(BOOKING_EXPIRY_PAGE_SIZE, BOOKING_EXPIRY_MAX_PER_PASS - result.scanned);
			const candidates = await this.bookingModel
				.find(filter)
				.select('_id selectedDate')
				.sort({ selectedDate: 1, _id: 1 })
				.limit(size)
				.lean<Candidate[]>()
				.exec();
			if (!candidates.length) {
				this.cursor = undefined;
				break;
			}
			for (const candidate of candidates) {
				if (this.stopping) break;
				try {
					await this.bookingExpiry.expireBooking(candidate._id.toHexString(), cutoff);
					result.expired++;
				} catch (error: unknown) {
					if (!(
						error instanceof NotFoundException ||
						error instanceof ConflictException ||
						error instanceof BadRequestException
					))
						throw error;
					result.skipped++;
					this.logger.warn(`Skipped booking ${candidate._id.toHexString()}: ${error.constructor.name}`);
				}
				result.scanned++;
				// Retain progress across bounded passes, including inconsistent records.
				this.cursor = { _id: candidate._id, selectedDate: candidate.selectedDate };
			}
			if (!this.stopping && candidates.length < size) {
				this.cursor = undefined;
				break;
			}
		}
		this.logger.log(JSON.stringify({ job: BOOKING_EXPIRY_JOB, ...result }));
		return result;
	}
}
