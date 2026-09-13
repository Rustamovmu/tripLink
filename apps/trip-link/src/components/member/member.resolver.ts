import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { createWriteStream } from 'node:fs';
import * as path from 'path';
import type { Readable } from 'node:stream';
import type { GraphQLScalarType } from 'graphql';
import * as graphqlUploadPackage from 'graphql-upload';
import { getSerialForImage, validMimeTypes } from '../../libs/config';
import { AgentsInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { AuthPayload, Member, Members } from '../../libs/dto/member/member';
import { MemberAdminUpdate, MemberUpdate } from '../../libs/dto/member/member.update';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/auth-member.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthTokenPayload } from '../auth/auth.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { MemberService } from './member.service';

interface FileUpload {
	createReadStream: () => Readable;
	filename: string;
	mimetype: string;
}

const GraphQLUpload = (
	graphqlUploadPackage as unknown as {
		GraphQLUpload: GraphQLScalarType;
	}
).GraphQLUpload;

@Resolver()
export class MemberResolver {
	constructor(private readonly memberService: MemberService) {}

	@Mutation(() => AuthPayload)
	public signup(@Args('input') input: MemberInput): Promise<AuthPayload> {
		return this.memberService.signup(input);
	}

	@Mutation(() => AuthPayload)
	public login(@Args('input') input: LoginInput): Promise<AuthPayload> {
		return this.memberService.login(input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => AuthPayload)
	public updateMember(@Args('input') input: MemberUpdate, @AuthMember('sub') memberId: string): Promise<AuthPayload> {
		return this.memberService.updateMember(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query(() => String)
	public checkAuth(@AuthMember('memberNick') memberNick: string): string {
		return `Hi ${memberNick}`;
	}

	@Roles(MemberType.USER, MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Query(() => String)
	public checkAuthRoles(@AuthMember() authMember: AuthTokenPayload): string {
		return `Hi ${authMember.memberNick}, you are ${authMember.memberType} (memberId: ${authMember.sub})`;
	}

	@UseGuards(WithoutGuard)
	@Query(() => Member)
	public getMember(@Args('memberId') memberId: string): Promise<Member> {
		return this.memberService.getMember(memberId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Members)
	public getAgents(@Args('input') input: AgentsInquiry): Promise<Members> {
		return this.memberService.getAgents(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Members)
	public getAllMembersByAdmin(@Args('input') input: MembersInquiry): Promise<Members> {
		return this.memberService.getAllMembersByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public updateMemberByAdmin(
		@Args('input') input: MemberAdminUpdate,
		@AuthMember('sub') adminId: string,
	): Promise<Member> {
		return this.memberService.updateMemberByAdmin(adminId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Member)
	public likeTargetMember(
		@Args('memberId') targetMemberId: string,
		@AuthMember('sub') memberId: string,
	): Promise<Member> {
		return this.memberService.likeTargetMember(memberId, targetMemberId);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => String)
	public async imageUploader(
		@Args({ name: 'file', type: () => GraphQLUpload }) file: unknown,
		@Args('target') target: string,
	): Promise<string> {
		console.log('Mutation: imageUploader');
		const { createReadStream, filename, mimetype } = await (file as Promise<FileUpload>);

		if (!filename) throw new Error(Message.UPLOAD_FAILED);
		const extension = path.extname(filename).toLowerCase();
		const validExtension = ['.jpg', '.jpeg', '.png'].includes(extension);
		const validMime = validMimeTypes.includes(mimetype);
		console.log('Upload file:', { filename, mimetype });
		if (!validMime && !(mimetype === 'application/octet-stream' && validExtension)) {
			throw new Error(`${Message.PROVIDE_ALLOWED_FORMAT} Received: ${mimetype || 'unknown'}`);
		}

		const imageName = getSerialForImage(filename);
		const url = `uploads/${target}/${imageName}`;
		const stream = createReadStream();

		const result = await new Promise<boolean>((resolve, reject) => {
			stream
				.pipe(createWriteStream(url))
				.on('finish', () => resolve(true))
				.on('error', () => reject(new Error(Message.UPLOAD_FAILED)));
		});
		if (!result) throw new Error(Message.UPLOAD_FAILED);

		return url;
	}

	@UseGuards(AuthGuard)
	@Mutation(() => [String])
	public async imagesUploader(
		@Args('files', { type: () => [GraphQLUpload] }) files: Promise<FileUpload>[],
		@Args('target') target: string,
	): Promise<string[]> {
		console.log('Mutation: imagesUploader');

		const uploadedImages: string[] = [];
		const promisedList = files.map(async (image: Promise<FileUpload>, index: number): Promise<void> => {
			try {
				const { filename, mimetype, createReadStream } = await image;

				const extension = path.extname(filename).toLowerCase();
				const validExtension = ['.jpg', '.jpeg', '.png'].includes(extension);
				const validMime = validMimeTypes.includes(mimetype);
				if (!validMime && !(mimetype === 'application/octet-stream' && validExtension)) {
					throw new Error(`${Message.PROVIDE_ALLOWED_FORMAT} Received: ${mimetype || 'unknown'}`);
				}

				const imageName = getSerialForImage(filename);
				const url = `uploads/${target}/${imageName}`;
				const stream = createReadStream();

				const result = await new Promise<boolean>((resolve, reject) => {
					stream
						.pipe(createWriteStream(url))
						.on('finish', () => resolve(true))
						.on('error', () => reject(new Error(Message.UPLOAD_FAILED)));
				});
				if (!result) throw new Error(Message.UPLOAD_FAILED);

				uploadedImages[index] = url;
			} catch {
				console.log('Error, file missing!');
			}
		});

		await Promise.all(promisedList);
		return uploadedImages;
	}
}
