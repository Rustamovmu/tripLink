import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	InternalServerErrorException,
	NotFoundException,
	UnauthorizedException,
	UnprocessableEntityException,
} from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { formatGraphQLError } from './graphql-error';

describe('GraphQL error formatting', () => {
	it.each([
		['NOT_FOUND', new NotFoundException('Tour not found')],
		['CONFLICT', new ConflictException('Booking is unsettled')],
	])('maps wrapped HTTP exception to %s', (code, exception) => {
		const original = new GraphQLError(exception.message, { originalError: exception, path: ['testResolver'] });
		expect(
			formatGraphQLError({ message: exception.message, extensions: { code: 'INTERNAL_SERVER_ERROR' } }, original),
		).toEqual({ message: exception.message, extensions: { code } });
	});

	it.each([
		['BAD_REQUEST', new BadRequestException('Invalid input')],
		['UNAUTHENTICATED', new UnauthorizedException('Login required')],
		['FORBIDDEN', new ForbiddenException('Admin only')],
		['BAD_USER_INPUT', new UnprocessableEntityException('Invalid value')],
		['INTERNAL_SERVER_ERROR', new InternalServerErrorException('Update failed')],
	])('preserves the Apollo driver code %s', (code, exception) => {
		expect(formatGraphQLError({ message: exception.message, extensions: { code } }, exception)).toEqual({
			message: exception.message,
			extensions: { code },
		});
	});

	it('joins field validation messages from a real Nest exception', () => {
		const exception = new BadRequestException([
			'tourId must be a mongodb id',
			'numberOfPeople must not be less than 1',
		]);
		const original = new GraphQLError(exception.message, { originalError: exception, path: ['testResolver'] });
		expect(
			formatGraphQLError({ message: 'Bad Request Exception', extensions: { code: 'BAD_REQUEST' } }, original),
		).toEqual({
			message: 'tourId must be a mongodb id, numberOfPeople must not be less than 1',
			extensions: { code: 'BAD_REQUEST' },
		});
	});

	it('reads the current Apollo originalError message and excludes private metadata', () => {
		expect(
			formatGraphQLError(
				{
					message: 'Bad Request Exception',
					extensions: {
						code: 'BAD_REQUEST',
						originalError: { message: ['Invalid id', 'Invalid date'], statusCode: 400 },
						stacktrace: ['private stack'],
					},
				},
				undefined,
			),
		).toEqual({ message: 'Invalid id, Invalid date', extensions: { code: 'BAD_REQUEST' } });
	});

	it.each([
		{ exception: { response: { message: 'Legacy exception message' } } },
		{ response: { message: 'Legacy exception message' } },
		{ originalError: { response: { message: 'Legacy exception message' } } },
	])('preserves legacy Nest message extraction', (extensions) => {
		expect(
			formatGraphQLError({ message: 'Fallback', extensions: { ...extensions, code: 'BAD_REQUEST' } }, undefined),
		).toEqual({ message: 'Legacy exception message', extensions: { code: 'BAD_REQUEST' } });
	});

	it('does not infer a not-found code from untrusted extension metadata', () => {
		expect(
			formatGraphQLError(
				{
					message: 'Unexpected failure',
					extensions: { code: 'INTERNAL_SERVER_ERROR', status: 404, originalError: { statusCode: 404 } },
				},
				new Error('Unexpected failure'),
			),
		).toEqual({ message: 'Unexpected failure', extensions: { code: 'INTERNAL_SERVER_ERROR' } });
	});

	it.each(['GRAPHQL_PARSE_FAILED', 'GRAPHQL_VALIDATION_FAILED', 'BAD_USER_INPUT', 'CUSTOM_CODE'])(
		'preserves %s for GraphQL errors',
		(code) => {
			const original = new GraphQLError('Invalid query', { extensions: { code } });
			expect(formatGraphQLError(original.toJSON(), original)).toEqual({
				message: 'Invalid query',
				extensions: { code },
			});
		},
	);

	it('uses the fallback message for an empty validation array and defaults missing codes', () => {
		expect(
			formatGraphQLError({ message: 'Unexpected failure', extensions: { originalError: { message: [] } } }, undefined),
		).toEqual({ message: 'Unexpected failure', extensions: { code: 'INTERNAL_SERVER_ERROR' } });
	});
});
