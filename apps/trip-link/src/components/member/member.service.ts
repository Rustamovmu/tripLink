import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { AuthPayload, Member, Members } from '../../libs/dto/member/member';
import { AgentsInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { MemberAdminUpdate, MemberUpdate } from '../../libs/dto/member/member.update';
import { Direction, Message } from '../../libs/enums/common.enum';
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

type MemberAdminUpdateFields = Partial<
	Pick<
		MemberRecord,
		| 'memberType'
		| 'memberStatus'
		| 'memberNick'
		| 'memberFullname'
		| 'memberImage'
		| 'memberCountry'
		| 'memberDesc'
		| 'memberFavoriteDestinations'
	>
> & { deletedAt?: Date };

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

	public async getMember(memberId: string): Promise<Member> {
		if (!isValidObjectId(memberId)) throw new BadRequestException(Message.BAD_REQUEST);

		const member = await this.memberModel.findOne({ _id: memberId, memberStatus: MemberStatus.ACTIVE }).exec();
		if (!member) throw new NotFoundException(Message.NO_DATA_FOUND);

		return this.toPublicMember(member.toObject());
	}

	public async getAgents(input: AgentsInquiry): Promise<Members> {
		const match: Record<string, unknown> = {
			memberType: MemberType.AGENT,
			memberStatus: MemberStatus.ACTIVE,
		};
		const text = input.search.text?.trim();
		if (text) {
			const searchExpression = new RegExp(this.escapeRegExp(text), 'i');
			match.$or = [{ memberNick: searchExpression }, { memberFullname: searchExpression }];
		}

		const sortField = input.sort ?? 'createdAt';
		const sortDirection = input.direction ?? Direction.DESC;
		const skip = (input.page - 1) * input.limit;

		const [result] = await this.memberModel
			.aggregate<Members>([
				{ $match: match },
				{ $sort: { [sortField]: sortDirection } },
				{
					$facet: {
						list: [
							{ $skip: skip },
							{ $limit: input.limit },
							{
								$project: {
									_id: 1,
									memberType: 1,
									memberStatus: 1,
									memberNick: 1,
									memberFullname: 1,
									memberImage: 1,
									memberCountry: 1,
									memberDesc: 1,
									memberFavoriteDestinations: 1,
									memberTours: 1,
									memberReviews: 1,
									memberFollowers: 1,
									memberFollowings: 1,
									memberLikes: 1,
									memberViews: 1,
									memberComments: 1,
									createdAt: 1,
									updatedAt: 1,
								},
							},
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		return result ?? { list: [], metaCounter: [] };
	}

	public async getAllMembersByAdmin(input: MembersInquiry): Promise<Members> {
		const match: Record<string, unknown> = {};
		if (input.search.memberType) match.memberType = input.search.memberType;
		if (input.search.memberStatus) match.memberStatus = input.search.memberStatus;

		const text = input.search.text?.trim();
		if (text) {
			const searchExpression = new RegExp(this.escapeRegExp(text), 'i');
			match.$or = [{ memberNick: searchExpression }, { memberFullname: searchExpression }];
		}

		const sortField = input.sort ?? 'createdAt';
		const sortDirection = input.direction ?? Direction.DESC;
		const skip = (input.page - 1) * input.limit;

		const [result] = await this.memberModel
			.aggregate<Members>([
				{ $match: match },
				{ $sort: { [sortField]: sortDirection } },
				{
					$facet: {
						list: [
							{ $skip: skip },
							{ $limit: input.limit },
							{
								$project: {
									_id: 1,
									memberType: 1,
									memberStatus: 1,
									memberNick: 1,
									memberFullname: 1,
									memberImage: 1,
									memberCountry: 1,
									memberDesc: 1,
									memberFavoriteDestinations: 1,
									memberTours: 1,
									memberReviews: 1,
									memberFollowers: 1,
									memberFollowings: 1,
									memberLikes: 1,
									memberViews: 1,
									memberComments: 1,
									createdAt: 1,
									updatedAt: 1,
								},
							},
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		return result ?? { list: [], metaCounter: [] };
	}

	public async updateMemberByAdmin(adminId: string, input: MemberAdminUpdate): Promise<Member> {
		if (!isValidObjectId(input.memberId)) throw new BadRequestException(Message.BAD_REQUEST);
		if (Object.values(input).some((value) => value === null)) {
			throw new BadRequestException(Message.BAD_REQUEST);
		}

		if (input.memberId.toLowerCase() === adminId.toLowerCase()) {
			const changesOwnRole = input.memberType !== undefined && input.memberType !== MemberType.ADMIN;
			const disablesOwnAccount = input.memberStatus !== undefined && input.memberStatus !== MemberStatus.ACTIVE;

			if (changesOwnRole || disablesOwnAccount) {
				throw new ForbiddenException(Message.NOT_ALLOWED_REQUEST);
			}
		}

		const update: MemberAdminUpdateFields = {};
		if (input.memberType !== undefined) update.memberType = input.memberType;
		if (input.memberStatus !== undefined) update.memberStatus = input.memberStatus;
		if (input.memberNick !== undefined) update.memberNick = input.memberNick.trim();
		if (input.memberFullname !== undefined) update.memberFullname = input.memberFullname.trim();
		if (input.memberImage !== undefined) update.memberImage = input.memberImage.trim();
		if (input.memberCountry !== undefined) update.memberCountry = input.memberCountry.trim();
		if (input.memberDesc !== undefined) update.memberDesc = input.memberDesc.trim();
		if (input.memberFavoriteDestinations !== undefined) {
			update.memberFavoriteDestinations = input.memberFavoriteDestinations.map((destination) => destination.trim());
		}

		if (Object.keys(update).length === 0) throw new BadRequestException(Message.NO_UPDATE_FIELDS);

		const updateOperation: {
			$set: MemberAdminUpdateFields;
			$unset?: { deletedAt: 1 };
		} = { $set: update };

		if (input.memberStatus === MemberStatus.DELETE) {
			update.deletedAt = new Date();
		} else if (input.memberStatus !== undefined) {
			updateOperation.$unset = { deletedAt: 1 };
		}

		try {
			const updatedMember = await this.memberModel
				.findOneAndUpdate({ _id: input.memberId }, updateOperation, { new: true, runValidators: true })
				.exec();

			if (!updatedMember) throw new NotFoundException(Message.NO_DATA_FOUND);
			return this.toPublicMember(updatedMember.toObject());
		} catch (error: unknown) {
			if (error instanceof NotFoundException) throw error;
			if (this.isDuplicateKeyError(error)) {
				throw new ConflictException(Message.USED_MEMBER_NICK_EMAIL_OR_PHONE);
			}
			if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'CastError')) {
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

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
