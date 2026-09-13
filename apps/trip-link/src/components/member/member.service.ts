import { BadRequestException, ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthPayload, Member } from '../../libs/dto/member/member';
import { MemberInput } from '../../libs/dto/member/member.input';
import { Message } from '../../libs/enums/common.enum';
import { MemberAuthType, MemberType } from '../../libs/enums/member.enum';
import { AuthService } from '../auth/auth.service';

type MemberRecord = Member & {
	memberAuthType: MemberAuthType;
	memberEmail?: string;
	memberPhone?: string;
	memberAddress?: string;
	memberPassword: string;
};

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
