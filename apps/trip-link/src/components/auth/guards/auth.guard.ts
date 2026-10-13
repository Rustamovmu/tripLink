import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { authFailure } from '../token.service';
import { AuthService, AuthTokenPayload } from '../auth.service';

export interface AuthenticatedGraphQLRequest {
	headers: {
		authorization?: string | string[];
	};
	authMember?: AuthTokenPayload;
}

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(private readonly authService: AuthService) {}

	public async canActivate(context: ExecutionContext): Promise<boolean> {
		const request =
			context.getType() === 'http'
				? context.switchToHttp().getRequest<AuthenticatedGraphQLRequest>()
				: GqlExecutionContext.create(context).getContext<{ req?: AuthenticatedGraphQLRequest }>().req;
		const authorization = request?.headers.authorization;

		if (!request || typeof authorization !== 'string') {
			throw authFailure('UNAUTHORIZED');
		}

		const [scheme, token, ...extraParts] = authorization.trim().split(/\s+/);
		if (scheme !== 'Bearer' || !token || extraParts.length > 0) {
			throw authFailure('UNAUTHORIZED');
		}

		request.authMember = await this.authService.verifyToken(token);
		return true;
	}
}
