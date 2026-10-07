import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { AuthService } from './auth.service';

describe('Current-account authentication', () => {
	const id = new Types.ObjectId();
	let jwt: JwtService;
	let service: AuthService;
	let exec: jest.Mock;
	let select: jest.Mock;
	let findById: jest.Mock;

	beforeEach(() => {
		jwt = new JwtService({ secret: 'unit-test-secret', signOptions: { expiresIn: '30d' } });
		exec = jest.fn();
		exec.mockResolvedValue({
			_id: id,
			memberStatus: MemberStatus.ACTIVE,
			memberType: MemberType.USER,
			memberNick: 'current-name',
		});
		select = jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec }) });
		findById = jest.fn().mockReturnValue({ select });
		service = new AuthService(jwt, { findById } as unknown as Model<never>);
	});

	function token(role = MemberType.USER) {
		return service.createToken({ _id: id, memberType: role, memberNick: 'old-name' });
	}

	it.each(Object.values(MemberType))(
		'authenticates an active %s with one minimal lookup and refreshed nickname',
		async (role) => {
			exec.mockResolvedValue({
				_id: id,
				memberStatus: MemberStatus.ACTIVE,
				memberType: role,
				memberNick: 'current-name',
			});
			expect(await service.verifyToken(await token(role))).toMatchObject({
				sub: id.toHexString(),
				memberType: role,
				memberNick: 'current-name',
			});
			expect(findById).toHaveBeenCalledTimes(1);
			expect(findById).toHaveBeenCalledWith(id.toHexString());
			expect(select).toHaveBeenCalledWith('_id memberStatus memberType memberNick');
		},
	);

	it.each(['not-a-token', 'a.b.c'])('rejects malformed token %s before querying MongoDB', async (value) => {
		await expect(service.verifyToken(value)).rejects.toBeInstanceOf(UnauthorizedException);
		expect(findById).not.toHaveBeenCalled();
	});

	it('rejects expired and incorrectly signed tokens before querying MongoDB', async () => {
		const expired = await jwt.signAsync({ sub: id.toHexString(), memberType: MemberType.USER }, { expiresIn: -1 });
		const forged = await new JwtService({ secret: 'other-secret' }).signAsync({
			sub: id.toHexString(),
			memberType: MemberType.USER,
		});
		for (const value of [expired, forged])
			await expect(service.verifyToken(value)).rejects.toBeInstanceOf(UnauthorizedException);
		expect(findById).not.toHaveBeenCalled();
	});

	it.each([
		{},
		{ sub: 'invalid', memberType: MemberType.USER },
		{ sub: 42, memberType: MemberType.USER },
		{ sub: id.toHexString() },
		{ sub: id.toHexString(), memberType: 'SUPERADMIN' },
	])('rejects invalid signed claims %j before querying MongoDB', async (claims) => {
		await expect(service.verifyToken(await jwt.signAsync(claims))).rejects.toBeInstanceOf(UnauthorizedException);
		expect(findById).not.toHaveBeenCalled();
	});

	it('rejects missing and deleted accounts', async () => {
		const value = await token();
		exec.mockResolvedValueOnce(null);
		await expect(service.verifyToken(value)).rejects.toBeInstanceOf(UnauthorizedException);
		exec.mockResolvedValueOnce({ _id: id, memberStatus: MemberStatus.DELETE, memberType: MemberType.USER });
		await expect(service.verifyToken(value)).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it.each([MemberStatus.PENDING, MemberStatus.BLOCK, MemberStatus.SUSPENDED])(
		'rejects %s accounts as forbidden',
		async (status) => {
			exec.mockResolvedValue({ _id: id, memberStatus: status, memberType: MemberType.USER });
			await expect(service.verifyToken(await token())).rejects.toBeInstanceOf(ForbiddenException);
		},
	);

	it('rejects promotion and demotion role mismatches', async () => {
		for (const role of [MemberType.ADMIN, MemberType.AGENT]) {
			exec.mockResolvedValue({ _id: id, memberStatus: MemberStatus.ACTIVE, memberType: role });
			await expect(service.verifyToken(await token())).rejects.toBeInstanceOf(UnauthorizedException);
		}
	});

	it('does not cache account state and re-enables a restored account', async () => {
		const value = await token();
		exec.mockResolvedValueOnce({ _id: id, memberStatus: MemberStatus.BLOCK, memberType: MemberType.USER });
		await expect(service.verifyToken(value)).rejects.toBeInstanceOf(ForbiddenException);
		await expect(service.verifyToken(value)).resolves.toMatchObject({ memberNick: 'current-name' });
		expect(findById).toHaveBeenCalledTimes(2);
	});

	it('propagates database failures without converting them to authentication errors', async () => {
		const failure = new Error('Database unavailable');
		exec.mockRejectedValue(failure);
		await expect(service.verifyToken(await token())).rejects.toBe(failure);
	});
});
