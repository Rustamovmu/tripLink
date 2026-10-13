import { AuthRecordsService } from './auth-records.service';
import { OidcProviderService } from './oidc-provider.service';
import { AccountSecurityService } from './account-security.service';
import { SocialAuthService } from './social-auth.service';
import { AccountSecurityController } from './account-security.controller';
import AuthIdentitySchema from '../../schemas/AuthIdentity.model';
import AuthTransactionSchema from '../../schemas/AuthTransaction.model';
import AuthSecuritySchema from '../../schemas/AuthSecurity.model';
import AuthEventSchema from '../../schemas/AuthEvent.model';
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
			{ name: 'AuthIdentity', schema: AuthIdentitySchema },
			{ name: 'AuthTransaction', schema: AuthTransactionSchema },
			{ name: 'AuthSecurity', schema: AuthSecuritySchema },
			{ name: 'AuthEvent', schema: AuthEventSchema },
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
	controllers: [AuthController, AccountSecurityController],
	providers: [
		AuthRecordsService,
		OidcProviderService,
		AccountSecurityService,
		SocialAuthService,
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
		AuthRecordsService,
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
