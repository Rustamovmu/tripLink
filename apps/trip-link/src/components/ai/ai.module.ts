import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import AiUsageSchema from '../../schemas/AiUsage.model';
import { AuthModule } from '../auth/auth.module';
import { TourModule } from '../tour/tour.module';
import { AiResolver } from './ai.resolver';
import { AiService } from './ai.service';
import { AiRateLimitService } from './ai-rate-limit.service';
import { GeminiProvider } from './gemini.provider';

@Module({
	imports: [
		ConfigModule,
		AuthModule,
		TourModule,
		MongooseModule.forFeature([{ name: 'AiUsage', schema: AiUsageSchema }]),
	],
	providers: [AiResolver, AiService, AiRateLimitService, GeminiProvider],
})
export class AiModule {}
