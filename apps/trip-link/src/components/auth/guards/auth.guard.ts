import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Message } from '../../../libs/enums/common.enum';
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
		const gqlContext = GqlExecutionContext.create(context);
		const request = gqlContext.getContext<{ req?: AuthenticatedGraphQLRequest }>().req;
		const authorization = request?.headers.authorization;

		if (!request || typeof authorization !== 'string') {
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}

		const [scheme, token, ...extraParts] = authorization.trim().split(/\s+/);
		if (scheme !== 'Bearer' || !token || extraParts.length > 0) {
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}

		try {
			request.authMember = await this.authService.verifyToken(token);
			return true;
		} catch {
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}
	}
}
