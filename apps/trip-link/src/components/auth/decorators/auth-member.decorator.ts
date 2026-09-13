import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthTokenPayload } from '../auth.service';
import type { AuthenticatedGraphQLRequest } from '../guards/auth.guard';

type AuthMemberKey = keyof Pick<AuthTokenPayload, 'sub' | 'memberType' | 'memberNick'>;

export const AuthMember = createParamDecorator(
	(
		data: AuthMemberKey | undefined,
		context: ExecutionContext,
	): AuthTokenPayload | AuthTokenPayload[AuthMemberKey] | null => {
		const gqlContext = GqlExecutionContext.create(context);
		const request = gqlContext.getContext<{ req?: AuthenticatedGraphQLRequest }>().req;
		const authMember = request?.authMember;

		if (!authMember) return null;
		return data ? authMember[data] : authMember;
	},
);
