import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import * as express from 'express';
import type { RequestHandler } from 'express';
import * as graphqlUploadPackage from 'graphql-upload';
import { AppModule } from './app.module';
import { uploadRoot } from './libs/config';
import { AuthConfig } from './components/auth/auth.config';
import { LoggingInterceptor } from './libs/interceptors/Logging.interceptor';

const graphqlUploadExpress = (
	graphqlUploadPackage as unknown as {
		graphqlUploadExpress: (options: { maxFileSize: number; maxFiles: number }) => RequestHandler;
	}
).graphqlUploadExpress;

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	const config = app.get(AuthConfig);
	const httpServer = app.getHttpAdapter().getInstance() as express.Express;
	httpServer.set('trust proxy', config.trustProxyHops);
	app.enableCors({
		origin: config.origins,
		credentials: true,
		methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
		allowedHeaders: [
			'Authorization',
			'Content-Type',
			'Apollo-Require-Preflight',
			'X-TripLink-Auth',
			'X-Refresh-Request-Id',
		],
		optionsSuccessStatus: 204,
	});
	app.useWebSocketAdapter(new WsAdapter(app));
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
