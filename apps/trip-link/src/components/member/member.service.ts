import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
	UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthPayload, Member } from '../../libs/dto/member/member';
import { LoginInput, MemberInput } from '../../libs/dto/member/member.input';
import { MemberUpdate } from '../../libs/dto/member/member.update';
import { Message } from '../../libs/enums/common.enum';
import { MemberAuthType, MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { AuthService } from '../auth/auth.service';

type MemberRecord = Member & {
	memberAuthType: MemberAuthType;
	memberEmail?: string;
	memberPhone?: string;
	memberAddress?: string;
	memberPassword: string;
};

type MemberUpdateFields = Partial<
	Pick<
		MemberRecord,
		| 'memberNick'
		| 'memberFullname'
		| 'memberImage'
		| 'memberCountry'
		| 'memberDesc'
		| 'memberFavoriteDestinations'
		| 'memberPassword'
	>
>;

@Injectable()
export class MemberService {
	constructor(
		@InjectModel('Member') private readonly memberModel: Model<MemberRecord>,
		private readonly authService: AuthService,
	) {}

	public async signup(input: MemberInput): Promise<AuthPayload> {
		const memberEmail = input.memberEmail?.trim().toLowerCase();
		const memberPhone = input.memberPhone?.trim();
		const memberAuthType = input.memberAuthType ?? (memberEmail ? MemberAuthType.EMAIL : MemberAuthType.PHONE);
		const memberType = input.memberType ?? MemberType.USER;

		this.validateSignupContact(memberAuthType, memberEmail, memberPhone);
		if (memberType !== MemberType.USER && memberType !== MemberType.AGENT) {
			throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		}

		const memberPassword = await this.authService.hashPassword(input.memberPassword);

		try {
			const createdMember = await this.memberModel.create({
				...input,
				memberNick: input.memberNick.trim(),
				memberEmail,
				memberPhone,
				memberAuthType,
				memberType,
				memberPassword,
			});

			const accessToken = await this.authService.createToken({
				_id: this.toObjectIdString(createdMember._id),
				memberType: createdMember.memberType,
				memberNick: createdMember.memberNick,
			});
			return {
				accessToken,
				member: this.toPublicMember(createdMember.toObject()),
			};
		} catch (error: unknown) {
			if (this.isDuplicateKeyError(error)) {
				throw new ConflictException(Message.USED_MEMBER_NICK_EMAIL_OR_PHONE);
			}

			if (error instanceof Error && error.name === 'ValidationError') {
				throw new BadRequestException(Message.BAD_REQUEST);
			}

			throw new InternalServerErrorException(Message.CREATE_FAILED);
		}
	}

	public async login(input: LoginInput): Promise<AuthPayload> {
		const member = await this.memberModel
			.findOne({ memberNick: input.memberNick.trim() })
			.select('+memberPassword')
			.exec();

		if (!member || member.memberStatus === MemberStatus.DELETE || !member.memberPassword) {
			throw new UnauthorizedException(Message.INVALID_CREDENTIALS);
		}

		if (member.memberStatus !== MemberStatus.ACTIVE) {
			throw new ForbiddenException(Message.ACCOUNT_UNAVAILABLE);
		}

		const passwordMatches = await this.authService.comparePasswords(input.memberPassword, member.memberPassword);
		if (!passwordMatches) throw new UnauthorizedException(Message.INVALID_CREDENTIALS);

		await this.memberModel
			.updateOne({ _id: member._id }, { $set: { lastLoginAt: new Date() } }, { timestamps: false })
			.exec();

		const accessToken = await this.authService.createToken({
			_id: this.toObjectIdString(member._id),
			memberType: member.memberType,
			memberNick: member.memberNick,
		});

		return {
			accessToken,
			member: this.toPublicMember(member.toObject()),
		};
	}

	public async updateMember(memberId: string, input: MemberUpdate): Promise<AuthPayload> {
		const { passwordChange } = input;
		const update: MemberUpdateFields = {};

		if (input.memberNick !== undefined) update.memberNick = input.memberNick.trim();
		if (input.memberFullname !== undefined) update.memberFullname = input.memberFullname.trim();
		if (input.memberImage !== undefined) update.memberImage = input.memberImage.trim();
		if (input.memberCountry !== undefined) update.memberCountry = input.memberCountry.trim();
		if (input.memberDesc !== undefined) update.memberDesc = input.memberDesc.trim();
		if (input.memberFavoriteDestinations !== undefined) {
			update.memberFavoriteDestinations = input.memberFavoriteDestinations.map((destination) => destination.trim());
		}

		let currentPasswordHash: string | undefined;
		if (passwordChange) {
			const member = await this.memberModel
				.findOne({ _id: memberId, memberStatus: MemberStatus.ACTIVE })
				.select('+memberPassword')
				.exec();

			if (!member) throw new ForbiddenException(Message.ACCOUNT_UNAVAILABLE);
			if (!member.memberPassword) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);

			currentPasswordHash = member.memberPassword;
			const currentPasswordMatches = await this.authService.comparePasswords(
				passwordChange.currentPassword,
				currentPasswordHash,
			);
			if (!currentPasswordMatches) throw new UnauthorizedException(Message.INCORRECT_CURRENT_PASSWORD);

			const reusesCurrentPassword = await this.authService.comparePasswords(
				passwordChange.newPassword,
				currentPasswordHash,
			);
			if (reusesCurrentPassword) throw new BadRequestException(Message.NEW_PASSWORD_MUST_DIFFER);

			update.memberPassword = await this.authService.hashPassword(passwordChange.newPassword);
		}

		if (Object.keys(update).length === 0) throw new BadRequestException(Message.NO_UPDATE_FIELDS);

		try {
			const search: Record<string, unknown> = { _id: memberId, memberStatus: MemberStatus.ACTIVE };
			if (currentPasswordHash) search.memberPassword = currentPasswordHash;

			const updatedMember = await this.memberModel
				.findOneAndUpdate(search, { $set: update }, { new: true, runValidators: true })
				.exec();

			if (!updatedMember) throw new ForbiddenException(Message.ACCOUNT_UNAVAILABLE);

			const accessToken = await this.authService.createToken({
				_id: this.toObjectIdString(updatedMember._id),
				memberType: updatedMember.memberType,
				memberNick: updatedMember.memberNick,
			});

			return {
				accessToken,
				member: this.toPublicMember(updatedMember.toObject()),
			};
		} catch (error: unknown) {
			if (error instanceof ForbiddenException) throw error;
			if (this.isDuplicateKeyError(error)) {
				throw new ConflictException(Message.USED_MEMBER_NICK_EMAIL_OR_PHONE);
			}
			if (error instanceof Error && error.name === 'ValidationError') {
				throw new BadRequestException(Message.BAD_REQUEST);
			}

			throw new InternalServerErrorException(Message.UPDATE_FAILED);
		}
	}

	private validateSignupContact(authType: MemberAuthType, email?: string, phone?: string): void {
		if (authType === MemberAuthType.TELEGRAM) {
			throw new BadRequestException(Message.UNSUPPORTED_AUTH_TYPE);
		}

		if ((authType === MemberAuthType.EMAIL && !email) || (authType === MemberAuthType.PHONE && !phone)) {
			throw new BadRequestException(Message.INVALID_AUTH_CONTACT);
		}
	}

	private isDuplicateKeyError(error: unknown): boolean {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
	}

	private toObjectIdString(value: unknown): string {
		if (typeof value === 'string') return value;

		if (typeof value === 'object' && value !== null && 'toHexString' in value) {
			const toHexString = value.toHexString;
			if (typeof toHexString === 'function') return toHexString.call(value) as string;
		}

		throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
	}

	private toPublicMember(member: MemberRecord): Member {
		return {
			_id: member._id,
			memberType: member.memberType,
			memberStatus: member.memberStatus,
			memberNick: member.memberNick,
			memberFullname: member.memberFullname,
			memberImage: member.memberImage,
			memberCountry: member.memberCountry,
			memberDesc: member.memberDesc,
			memberFavoriteDestinations: member.memberFavoriteDestinations,
			memberTours: member.memberTours,
			memberReviews: member.memberReviews,
			memberFollowers: member.memberFollowers,
			memberFollowings: member.memberFollowings,
			memberLikes: member.memberLikes,
			memberViews: member.memberViews,
			memberComments: member.memberComments,
			createdAt: member.createdAt,
			updatedAt: member.updatedAt,
		};
	}
}
