import { HttpException, HttpStatus } from '@nestjs/common';
import { unwrapResolverError } from '@apollo/server/errors';
import { GraphQLFormattedError } from 'graphql';

type ErrorRecord = Record<string, unknown>;
const HTTP_ERROR_CODES: Partial<Record<number, string>> = {
	[HttpStatus.NOT_FOUND]: 'NOT_FOUND',
	[HttpStatus.CONFLICT]: 'CONFLICT',
};

const isErrorRecord = (value: unknown): value is ErrorRecord => typeof value === 'object' && value !== null;

const getNestedValue = (value: unknown, path: string[]): unknown => {
	let currentValue = value;
	for (const key of path) {
		if (!isErrorRecord(currentValue)) return undefined;
		currentValue = currentValue[key];
	}
	return currentValue;
};

export const formatGraphQLError = (error: GraphQLFormattedError, originalError: unknown): GraphQLFormattedError => {
	const exception = unwrapResolverError(originalError);
	let code = error.extensions?.code ?? 'INTERNAL_SERVER_ERROR';
	let responseMessage: unknown;
	if (exception instanceof HttpException) {
		code = HTTP_ERROR_CODES[exception.getStatus()] ?? code;
		const response = exception.getResponse();
		responseMessage = typeof response === 'string' ? response : getNestedValue(response, ['message']);
	}

	const extensionMessage =
		responseMessage ??
		getNestedValue(error.extensions, ['originalError', 'message']) ??
		getNestedValue(error.extensions, ['exception', 'response', 'message']) ??
		getNestedValue(error.extensions, ['response', 'message']) ??
		getNestedValue(error.extensions, ['originalError', 'response', 'message']);
	const message = Array.isArray(extensionMessage)
		? extensionMessage.filter((value): value is string => typeof value === 'string').join(', ')
		: extensionMessage;

	// Return only the public message and code, excluding exception details and stack traces.
	return { message: typeof message === 'string' && message.length > 0 ? message : error.message, extensions: { code } };
};
