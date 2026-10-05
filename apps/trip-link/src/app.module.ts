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
import { formatGraphQLError } from './libs/utils/graphql-error';

const graphQLLogger = new Logger('GraphQL');

@Module({
	imports: [
		ConfigModule.forRoot(),
		GraphQLModule.forRoot({
			driver: ApolloDriver,
			playground: true,
			uploads: false,
			autoSchemaFile: true,
			formatError: (error: GraphQLFormattedError, originalError: unknown): GraphQLFormattedError => {
				const formattedError = formatGraphQLError(error, originalError);

				graphQLLogger.error(`${String(formattedError.extensions?.code)}: ${formattedError.message}`);
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
