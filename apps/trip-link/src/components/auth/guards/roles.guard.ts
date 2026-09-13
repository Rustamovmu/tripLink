import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Message } from '../../../libs/enums/common.enum';
import { MemberType } from '../../../libs/enums/member.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthGuard, AuthenticatedGraphQLRequest } from './auth.guard';

@Injectable()
export class RolesGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly authGuard: AuthGuard,
	) {}

	public async canActivate(context: ExecutionContext): Promise<boolean> {
		const allowedRoles = this.reflector.getAllAndOverride<MemberType[]>(ROLES_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (!allowedRoles?.length) return true;

		await this.authGuard.canActivate(context);

		const gqlContext = GqlExecutionContext.create(context);
		const request = gqlContext.getContext<{ req?: AuthenticatedGraphQLRequest }>().req;
		const authMember = request?.authMember;

		if (!authMember || !allowedRoles.includes(authMember.memberType)) {
			throw new ForbiddenException(Message.ONLY_SPECIFIC_ROLES_ALLOWED);
		}

		return true;
	}
}
