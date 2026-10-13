import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import MemberSchema from '../../schemas/Member.model';
import RefreshSessionSchema from '../../schemas/RefreshSession.model';
import AuthRateLimitSchema from '../../schemas/AuthRateLimit.model';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { WithoutGuard } from './guards/without.guard';
import { AuthEntryGuard } from './guards/auth-entry.guard';
import { AuthService } from './auth.service';
import { AuthConfig } from './auth.config';
import { TokenService } from './token.service';
import { AuthSessionService } from './auth-session.service';
import { AuthCookieService } from './auth-cookie.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthController } from './auth.controller';
@Module({
	imports: [
		ConfigModule,
		MongooseModule.forFeature([
			{ name: 'Member', schema: MemberSchema },
			{ name: 'RefreshSession', schema: RefreshSessionSchema },
			{ name: 'AuthRateLimit', schema: AuthRateLimitSchema },
		]),
		JwtModule.registerAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (config: ConfigService) => ({
				secret: config.get<string>('JWT_ACCESS_SECRET'),
				signOptions: { algorithm: 'HS256' },
			}),
		}),
	],
	controllers: [AuthController],
	providers: [
		AuthConfig,
		TokenService,
		AuthSessionService,
		AuthCookieService,
		AuthRateLimitService,
		AuthService,
		AuthGuard,
		RolesGuard,
		WithoutGuard,
		AuthEntryGuard,
	],
	exports: [
		AuthRateLimitService,
		AuthService,
		AuthGuard,
		RolesGuard,
		WithoutGuard,
		AuthEntryGuard,
		AuthCookieService,
		AuthConfig,
		TokenService,
		AuthSessionService,
	],
})
export class AuthModule {}
