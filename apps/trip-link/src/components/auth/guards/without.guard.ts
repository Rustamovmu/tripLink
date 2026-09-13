import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard, AuthenticatedGraphQLRequest } from './auth.guard';

@Injectable()
export class WithoutGuard implements CanActivate {
	constructor(private readonly authGuard: AuthGuard) {}

	public canActivate(context: ExecutionContext): boolean | Promise<boolean> {
		const gqlContext = GqlExecutionContext.create(context);
		const request = gqlContext.getContext<{ req?: AuthenticatedGraphQLRequest }>().req;

		if (!request?.headers.authorization) {
			if (request) request.authMember = undefined;
			return true;
		}

		return this.authGuard.canActivate(context);
	}
}
