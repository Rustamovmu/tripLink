import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { GraphQLError } from 'graphql';
import { Model } from 'mongoose';
import { AI_LEASE_MS } from './ai.constants';

export interface AiUsage {
	_id: string;
	count: number;
	owner?: string;
	expiresAt: Date;
}
const duplicate = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
const limited = () =>
	new GraphQLError('Please wait before sending another AI message.', { extensions: { code: 'AI_RATE_LIMITED' } });

@Injectable()
export class AiRateLimitService {
	constructor(@InjectModel('AiUsage') private readonly usage: Model<AiUsage>) {}

	async reserve(memberId: string): Promise<() => Promise<void>> {
		const now = Date.now();
		const key = `lease:${memberId}`;
		const owner = randomUUID();
		try {
			await this.usage
				.findOneAndUpdate(
					{ _id: key, expiresAt: { $lte: new Date(now) } },
					{ $set: { owner, count: 0, expiresAt: new Date(now + AI_LEASE_MS) } },
					{ upsert: true, new: true },
				)
				.exec();
		} catch (error: unknown) {
			if (duplicate(error)) throw limited();
			throw error;
		}
		const release = async () => {
			await this.usage.deleteOne({ _id: key, owner }).exec();
		};
		try {
			// Fixed UTC windows, shared across processes. Failed attempts consume quota.
			for (const [scope, windowMs, limit] of [
				[memberId, 60000, 6],
				[memberId, 86400000, 60],
				['global', 60000, 60],
				['global', 86400000, 1000],
			] as const) {
				const bucket = Math.floor(now / windowMs);
				await this.usage
					.findOneAndUpdate(
						{ _id: `quota:${scope}:${windowMs}:${bucket}`, count: { $lt: limit } },
						{ $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) } },
						{ upsert: true, new: true },
					)
					.exec();
			}
		} catch (error: unknown) {
			await release();
			if (duplicate(error)) throw limited();
			throw error;
		}
		return release;
	}
}
