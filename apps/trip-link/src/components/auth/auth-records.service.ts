import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { ClientSession, Model, Types } from 'mongoose';
import { AuthConfig } from './auth.config';
export type Provider = 'GOOGLE' | 'TELEGRAM' | 'KAKAO';
export interface Identity {
	memberId: Types.ObjectId;
	provider: Provider;
	providerUserId: string;
	createdAt: Date;
	lastUsedAt?: Date;
}
export interface SecurityRecord {
	memberId: Types.ObjectId;
	revision: number;
	recoveryEmail?: string;
	emailVerifiedAt?: Date;
	recoveryCodeHashes: string[];
}
export interface AuthTransaction {
	_id: string;
	kind: 'OAUTH' | 'ONBOARDING' | 'SOCIAL_LOGIN' | 'RESET' | 'VERIFY';
	bindingHash?: string;
	sealed: string;
	expiresAt: Date;
	consumedAt: Date | null;
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomSecret = () => randomBytes(32).toString('base64url');
@Injectable()
export class AuthRecordsService {
	private readonly key: Buffer;
	constructor(
		@InjectModel('AuthTransaction') readonly transactions: Model<AuthTransaction>,
		@InjectModel('AuthIdentity') readonly identities: Model<Identity>,
		@InjectModel('AuthSecurity') readonly security: Model<SecurityRecord>,
		@InjectModel('AuthEvent')
		private readonly events: Model<{ memberId?: Types.ObjectId; action: string; provider?: Provider; expiresAt: Date }>,
		config: AuthConfig,
	) {
		this.key = createHash('sha256')
			.update('triplink-auth-transactions:' + config.refreshSecret)
			.digest();
	}
	seal(value: unknown): string {
		const iv = randomBytes(12),
			cipher = createCipheriv('aes-256-gcm', this.key, iv);
		const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
		return [iv, cipher.getAuthTag(), ciphertext].map((v) => v.toString('base64url')).join('.');
	}
	open<T>(value: string): T {
		const [iv, tag, ciphertext] = value.split('.').map((v) => Buffer.from(v, 'base64url'));
		const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
		decipher.setAuthTag(tag);
		return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as T;
	}
	async create(kind: AuthTransaction['kind'], payload: unknown, minutes: number, binding?: string) {
		const raw = randomSecret();
		await this.transactions.create({
			_id: digest(raw),
			kind,
			sealed: this.seal(payload),
			expiresAt: new Date(Date.now() + minutes * 60000),
			...(binding ? { bindingHash: digest(binding) } : {}),
		});
		return raw;
	}
	async consume<T>(raw: string, kind: AuthTransaction['kind'], binding?: string, session?: ClientSession): Promise<T> {
		if (!/^[A-Za-z0-9_-]{43}$/.test(raw))
			throw new UnauthorizedException('This request has expired. Please try again.');
		const record = await this.transactions
			.findOneAndUpdate(
				{
					_id: digest(raw),
					kind,
					consumedAt: null,
					expiresAt: { $gt: new Date() },
					...(binding ? { bindingHash: digest(binding) } : {}),
				},
				{ $set: { consumedAt: new Date() } },
				{ session, new: true },
			)
			.select('+sealed')
			.lean()
			.exec();
		if (!record) throw new UnauthorizedException('This request has expired. Please try again.');
		return this.open<T>(record.sealed);
	}
	async serialize(memberId: string, session: ClientSession) {
		// Every credential mutation writes the same member security record: concurrent unlink/reset/link
		// transactions conflict and retry rather than leaving an account without a usable method.
		await this.security.findOneAndUpdate({ memberId }, { $inc: { revision: 1 } }, { upsert: true, session }).exec();
	}
	event(memberId: string | undefined, action: string, provider?: Provider, session?: ClientSession) {
		return this.events.create([{ memberId, action, provider, expiresAt: new Date(Date.now() + 90 * 86400000) }], {
			session,
		});
	}
}
