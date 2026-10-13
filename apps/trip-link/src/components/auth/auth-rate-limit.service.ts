import { HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
@Injectable()
export class AuthRateLimitService {
	constructor(
		@InjectModel('AuthRateLimit') private readonly limits: Model<{ _id: string; count: number; expiresAt: Date }>,
	) {}
	async consume(scope: string, identifier: string, maximum: number, windowMs = 60000) {
		const bucket = Math.floor(Date.now() / windowMs);
		const key = createHash('sha256').update(`${scope}:${identifier}:${bucket}`).digest('hex');
		try {
			await this.limits
				.findOneAndUpdate(
					{ _id: key, count: { $lt: maximum } },
					{ $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) } },
					{ upsert: true },
				)
				.exec();
		} catch (error: unknown) {
			if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
				throw new HttpException(
					{ message: 'Too many authentication requests. Please try again later.', authCode: 'AUTH_RATE_LIMITED' },
					429,
				);
			throw error;
		}
	}
}
