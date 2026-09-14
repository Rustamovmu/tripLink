import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import type { RequestHandler } from 'express';
import * as graphqlUploadPackage from 'graphql-upload';
import { AppModule } from './app.module';
import { uploadRoot } from './libs/config';
import { LoggingInterceptor } from './libs/interceptors/Logging.interceptor';

const graphqlUploadExpress = (
	graphqlUploadPackage as unknown as {
		graphqlUploadExpress: (options: { maxFileSize: number; maxFiles: number }) => RequestHandler;
	}
).graphqlUploadExpress;

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		}),
	);
	app.useGlobalInterceptors(new LoggingInterceptor());
	app.use('/graphql', graphqlUploadExpress({ maxFileSize: 15000000, maxFiles: 10 }));
	app.use(
		'/uploads',
		express.static(uploadRoot, {
			dotfiles: 'deny',
			index: false,
			setHeaders: (response) => {
				response.setHeader('X-Content-Type-Options', 'nosniff');
				response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
			},
		}),
	);
	await app.listen(process.env.PORT_API ?? 3000);
}
void bootstrap();
