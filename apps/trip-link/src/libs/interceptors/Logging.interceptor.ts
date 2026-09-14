import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

interface GraphQLRequest {
	body?: {
		operationName?: unknown;
		query?: unknown;
	};
}

interface GraphQLContext {
	req?: GraphQLRequest;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
	private readonly logger = new Logger(LoggingInterceptor.name);

	public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const requestType = context.getType<GqlContextType>();

		if (requestType !== 'graphql') return next.handle();

		const startedAt = Date.now();
		const gqlExecutionContext = GqlExecutionContext.create(context);
		const gqlContext = gqlExecutionContext.getContext<GraphQLContext>();
		const operationName = this.getOperationName(gqlContext.req?.body);

		this.logger.log(`${operationName} started`);

		return next.handle().pipe(
			tap(() => {
				const responseTime = Date.now() - startedAt;
				this.logger.log(`${operationName} completed in ${responseTime}ms`);
			}),
		);
	}

	private getOperationName(body?: GraphQLRequest['body']): string {
		if (typeof body?.operationName === 'string' && body.operationName.length > 0) {
			return body.operationName;
		}

		if (typeof body?.query === 'string') {
			const operationMatch = body.query.match(/\b(query|mutation|subscription)\s+(\w+)/);
			if (operationMatch?.[2]) return operationMatch[2];
		}

		return 'Anonymous GraphQL operation';
	}
}
