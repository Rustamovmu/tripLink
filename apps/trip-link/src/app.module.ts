import { Logger, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { GraphQLFormattedError } from 'graphql';
import { AppResolver } from './app.resolver';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';

type ErrorRecord = Record<string, unknown>;

const graphQLLogger = new Logger('GraphQL');

const isErrorRecord = (value: unknown): value is ErrorRecord => typeof value === 'object' && value !== null;

const getNestedValue = (value: unknown, path: string[]): unknown => {
	let currentValue = value;

	for (const key of path) {
		if (!isErrorRecord(currentValue)) return undefined;
		currentValue = currentValue[key];
	}

	return currentValue;
};

const getErrorMessage = (error: GraphQLFormattedError): string => {
	const extensionMessage =
		getNestedValue(error.extensions, ['exception', 'response', 'message']) ??
		getNestedValue(error.extensions, ['response', 'message']) ??
		getNestedValue(error.extensions, ['originalError', 'response', 'message']);

	if (Array.isArray(extensionMessage)) {
		return extensionMessage.filter((message): message is string => typeof message === 'string').join(', ');
	}

	return typeof extensionMessage === 'string' ? extensionMessage : error.message;
};

@Module({
	imports: [
		ConfigModule.forRoot(),
		GraphQLModule.forRoot({
			driver: ApolloDriver,
			playground: true,
			uploads: false,
			autoSchemaFile: true,
			formatError: (error: GraphQLFormattedError): GraphQLFormattedError => {
				const formattedError = {
					message: getErrorMessage(error),
					extensions: {
						code: error.extensions?.code,
					},
				};

				graphQLLogger.error(`${String(formattedError.extensions.code)}: ${formattedError.message}`);
				return formattedError;
			},
		}),
		ComponentsModule,
		DatabaseModule,
	],
	controllers: [AppController],
	providers: [AppService, AppResolver],
})
export class AppModule {}
