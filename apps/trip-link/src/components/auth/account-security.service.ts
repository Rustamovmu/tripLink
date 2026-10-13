import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types, ClientSession } from 'mongoose';
import * as nodemailer from 'nodemailer';
import { AuthService, AuthTokenPayload } from './auth.service';
import { AuthSessionService, RefreshSession } from './auth-session.service';
import { AuthRecordsService, digest, randomSecret, Provider } from './auth-records.service';
import { validateNewPassword } from './account-policy';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
export interface SecurityMember {
	_id: Types.ObjectId;
	memberNick: string;
	memberPassword?: string;
	memberStatus: MemberStatus;
	memberType: MemberType;
	authVersion?: number;
}
type ResetTransaction = { memberId: string; revision: number; passwordHash?: string };
type VerificationTransaction = { memberId: string; email: string; revision: number };
@Injectable()
export class AccountSecurityService {
	private readonly mail: ReturnType<typeof nodemailer.createTransport> | undefined;
	private readonly from: string;
	readonly frontend: string;
	constructor(
		@InjectModel('Member') private readonly members: Model<SecurityMember>,
		@InjectModel('RefreshSession') private readonly sessionModel: Model<RefreshSession>,
		@InjectModel('AuthEvent')
		private readonly eventModel: Model<{
			memberId: Types.ObjectId;
			action: string;
			provider?: Provider;
			createdAt: Date;
		}>,
		private readonly records: AuthRecordsService,
		private readonly auth: AuthService,
		private readonly sessions: AuthSessionService,
		config: ConfigService,
	) {
		this.frontend =
			config.get<string>('AUTH_FRONTEND_URL') ??
			(config.get<string>('FRONTEND_ORIGINS') ?? 'http://localhost:3000').split(',')[0].trim();
		this.from = config.get<string>('EMAIL_FROM') ?? '';
		if (config.get<string>('SMTP_ENABLED') === 'true') {
			const host = config.get<string>('SMTP_HOST'),
				port = Number(config.get<string>('SMTP_PORT') ?? '587');
			if (!host || !this.from || ![465, 587].includes(port))
				throw new Error('Configure SMTP_HOST, SMTP_PORT (465/587), and EMAIL_FROM before enabling email');
			this.mail = nodemailer.createTransport({
				host,
				port,
				secure: port === 465,
				requireTLS: port === 587,
				auth: config.get<string>('SMTP_USER')
					? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASSWORD') }
					: undefined,
				connectionTimeout: 10000,
				socketTimeout: 10000,
				logger: false,
				debug: false,
				tls: { rejectUnauthorized: true },
			});
		}
	}
	async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
		const session = await this.members.db.startSession();
		try {
			return await session.withTransaction(() => work(session));
		} finally {
			await session.endSession();
		}
	}
	async status(actor: AuthTokenPayload) {
		const [member, record, identities, events] = await Promise.all([
			this.members.findById(actor.sub).select('memberNick +memberPassword').lean().exec(),
			this.records.security.findOne({ memberId: actor.sub }).select('+recoveryEmail +recoveryCodeHashes').lean().exec(),
			this.records.identities.find({ memberId: actor.sub }).select('provider createdAt lastUsedAt').lean().exec(),
			this.eventModel
				.find({ memberId: actor.sub })
				.sort({ createdAt: -1 })
				.limit(15)
				.select('action provider createdAt -_id')
				.lean()
				.exec(),
		]);
		return {
			username: member?.memberNick,
			hasPassword: !!member?.memberPassword,
			recoveryEmail: record?.recoveryEmail ?? '',
			emailVerified: !!record?.emailVerifiedAt,
			recoveryCodesRemaining: record?.recoveryCodeHashes.length ?? 0,
			emailDeliveryAvailable: !!this.mail,
			identities: identities.map((i) => ({ provider: i.provider, linkedAt: i.createdAt, lastUsedAt: i.lastUsedAt })),
			events,
		};
	}
	async reauthenticate(actor: AuthTokenPayload, password: string) {
		const member = await this.members.findById(actor.sub).select('+memberPassword').lean().exec();
		if (!member?.memberPassword || !(await this.auth.comparePasswords(password, member.memberPassword)))
			throw new BadRequestException('Unable to confirm your identity. Please try again.');
		await this.sessions.markAuthenticated(actor.sid, actor.sub);
		await this.records.event(actor.sub, 'REAUTHENTICATED');
		return { success: true };
	}
	async unlink(actor: AuthTokenPayload, provider: Provider) {
		await this.sessions.assertRecent(actor.sid, actor.sub);
		return this.transaction(async (session) => {
			await this.records.serialize(actor.sub, session);
			const member = await this.members.findById(actor.sub).select('+memberPassword').session(session).lean().exec();
			const identities = await this.records.identities.find({ memberId: actor.sub }).session(session).lean().exec();
			if (!member?.memberPassword && identities.length <= 1)
				throw new BadRequestException(
					'Connect another sign-in method or add a password before disconnecting this account.',
				);
			const result = await this.records.identities.deleteOne({ memberId: actor.sub, provider }, { session }).exec();
			if (!result.deletedCount) throw new BadRequestException('This provider is not connected.');
			await this.sessionModel
				.updateMany(
					{ memberId: actor.sub, _id: { $ne: actor.sid }, revokedAt: null },
					{ $set: { revokedAt: new Date() } },
					{ session },
				)
				.exec();
			await this.records.event(actor.sub, 'PROVIDER_DISCONNECTED', provider, session);
			return { success: true };
		});
	}
	async setPassword(actor: AuthTokenPayload, password: string) {
		await this.sessions.assertRecent(actor.sid, actor.sub);
		validateNewPassword(password);
		const hash = await this.auth.hashPassword(password);
		await this.transaction(async (session) => {
			await this.records.serialize(actor.sub, session);
			const member = await this.members
				.findById(actor.sub)
				.select('+memberPassword +authVersion')
				.session(session)
				.lean()
				.exec();
			if (member?.memberPassword)
				throw new BadRequestException('Use Change password for an account that already has a password.');
			const updated = await this.members
				.findOneAndUpdate(
					{ _id: actor.sub, memberStatus: MemberStatus.ACTIVE, memberPassword: { $exists: false } },
					{ $set: { memberPassword: hash }, $inc: { authVersion: 1 } },
					{ session, new: true },
				)
				.select('+authVersion')
				.lean()
				.exec();
			if (!updated) throw new ForbiddenException('This account is not available.');
			await this.sessionModel
				.updateOne(
					{ _id: actor.sid, memberId: actor.sub, revokedAt: null },
					{ $set: { authVersion: updated.authVersion, lastAuthenticatedAt: new Date() } },
					{ session },
				)
				.exec();
			await this.sessionModel
				.updateMany(
					{ memberId: actor.sub, _id: { $ne: actor.sid }, revokedAt: null },
					{ $set: { revokedAt: new Date() } },
					{ session },
				)
				.exec();
			await this.records.event(actor.sub, 'PASSWORD_ADDED', undefined, session);
		});
		return { success: true };
	}
	async generateCodes(actor: AuthTokenPayload) {
		await this.sessions.assertRecent(actor.sid, actor.sub);
		const codes = Array.from({ length: 10 }, () => randomSecret().slice(0, 24));
		await this.transaction(async (session) => {
			await this.records.serialize(actor.sub, session);
			await this.records.security
				.updateOne({ memberId: actor.sub }, { $set: { recoveryCodeHashes: codes.map(digest) } }, { session })
				.exec();
			await this.records.event(actor.sub, 'RECOVERY_CODES_REGENERATED', undefined, session);
		});
		return { codes };
	}
	async requestEmail(actor: AuthTokenPayload, email: string) {
		await this.sessions.assertRecent(actor.sid, actor.sub);
		if (!this.mail)
			throw new ServiceUnavailableException(
				'Email delivery is not configured. Use recovery codes to protect your account.',
			);
		const normalized = email.trim().toLowerCase();
		const record = await this.records.security.findOne({ memberId: actor.sub }).lean().exec();
		// Keep the existing verified address usable until the new address is actually verified.
		const raw = await this.records.create(
			'VERIFY',
			{ memberId: actor.sub, email: normalized, revision: record?.revision ?? 0 } satisfies VerificationTransaction,
			30,
		);
		await this.mail.sendMail({
			from: this.from,
			to: normalized,
			subject: 'Verify your TripLink recovery email',
			text: `Confirm this address for your TripLink account. This link expires in 30 minutes.\n${this.frontend}/account/recovery#verify=${raw}`,
		});
		return { success: true };
	}
	async verifyEmail(raw: string) {
		return this.transaction(async (session) => {
			const data = await this.records.consume<VerificationTransaction>(raw, 'VERIFY', undefined, session);
			const member = await this.members
				.findOne({ _id: data.memberId, memberStatus: MemberStatus.ACTIVE })
				.session(session)
				.lean()
				.exec();
			if (!member) throw new BadRequestException('This verification request is no longer valid.');
			const current = await this.records.security.findOne({ memberId: data.memberId }).session(session).lean().exec();
			if ((current?.revision ?? 0) !== data.revision)
				throw new BadRequestException('Request a new verification email to continue.');
			await this.records.serialize(data.memberId, session);
			try {
				await this.records.security
					.updateOne(
						{ memberId: data.memberId },
						{ $set: { recoveryEmail: data.email, emailVerifiedAt: new Date() } },
						{ session },
					)
					.exec();
			} catch (error: unknown) {
				if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
					throw new ConflictException('This email cannot be used for this account.');
				throw error;
			}
			await this.records.event(data.memberId, 'RECOVERY_EMAIL_VERIFIED', undefined, session);
			return { success: true };
		});
	}
	async forgot(identifier: string) {
		// Identical response for absent accounts, unverified addresses and unconfigured delivery.
		const normalized = identifier.trim().toLowerCase();
		const member = await this.members
			.findOne({ memberNick: identifier.trim(), memberStatus: MemberStatus.ACTIVE })
			.collation({ locale: 'en', strength: 2 })
			.select('+memberPassword')
			.lean()
			.exec();
		const record = await this.records.security
			.findOne({
				...(normalized.includes('@')
					? { recoveryEmail: normalized }
					: { memberId: member?._id ?? new Types.ObjectId() }),
				emailVerifiedAt: { $exists: true },
			})
			.select('+recoveryEmail')
			.lean()
			.exec();
		if (record && this.mail) {
			const account = await this.members
				.findOne({ _id: record.memberId, memberStatus: MemberStatus.ACTIVE })
				.select('+memberPassword')
				.lean()
				.exec();
			if (account) {
				const raw = await this.records.create(
					'RESET',
					{
						memberId: String(account._id),
						revision: record.revision,
						passwordHash: account.memberPassword,
					} satisfies ResetTransaction,
					15,
				);
				void this.mail
					.sendMail({
						from: this.from,
						to: record.recoveryEmail,
						subject: 'Reset your TripLink password',
						text: `Reset your TripLink password. This link expires in 15 minutes.\n${this.frontend}/account/recovery#reset=${raw}`,
					})
					.catch(() => {
						/* Never disclose eligibility or SMTP responses. */
					});
			}
		}
		return { message: 'If a verified recovery email is available, you will receive a reset link.' };
	}
	async reset(input: { token?: string; memberNick?: string; recoveryCode?: string; password: string }) {
		validateNewPassword(input.password);
		const hash = await this.auth.hashPassword(input.password);
		await this.transaction(async (session) => {
			let memberId: string;
			if (input.token) {
				const data = await this.records.consume<ResetTransaction>(input.token, 'RESET', undefined, session);
				const current = await this.records.security.findOne({ memberId: data.memberId }).session(session).lean().exec();
				const account = await this.members
					.findById(data.memberId)
					.select('+memberPassword')
					.session(session)
					.lean()
					.exec();
				if (!current || current.revision !== data.revision || account?.memberPassword !== data.passwordHash)
					throw new BadRequestException('This recovery request has expired. Please try again.');
				memberId = data.memberId;
			} else {
				const member = await this.members
					.findOne({ memberNick: input.memberNick?.trim(), memberStatus: MemberStatus.ACTIVE })
					.collation({ locale: 'en', strength: 2 })
					.session(session)
					.lean()
					.exec();
				if (!member || !input.recoveryCode)
					throw new BadRequestException('Unable to recover this account. Check your recovery details.');
				memberId = String(member._id);
				const used = await this.records.security
					.updateOne(
						{ memberId, recoveryCodeHashes: digest(input.recoveryCode.trim()) },
						{ $pull: { recoveryCodeHashes: digest(input.recoveryCode.trim()) } },
						{ session },
					)
					.exec();
				if (!used.modifiedCount)
					throw new BadRequestException('Unable to recover this account. Check your recovery details.');
			}
			await this.records.serialize(memberId, session);
			const updated = await this.members
				.updateOne(
					{ _id: memberId, memberStatus: MemberStatus.ACTIVE },
					{ $set: { memberPassword: hash }, $inc: { authVersion: 1 } },
					{ session },
				)
				.exec();
			if (!updated.matchedCount)
				throw new BadRequestException('Unable to recover this account. Check your recovery details.');
			await this.sessionModel
				.updateMany({ memberId, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session })
				.exec();
			await this.records.event(memberId, 'PASSWORD_RECOVERED', undefined, session);
		});
		return { success: true };
	}
}
