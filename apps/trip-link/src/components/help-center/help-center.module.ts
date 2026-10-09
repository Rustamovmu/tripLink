import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import NoticeSchema from '../../schemas/Notice.model';
import { AuthModule } from '../auth/auth.module';
import { HelpCenterResolver } from './help-center.resolver';
import { HelpCenterService } from './help-center.service';
@Module({
	imports: [AuthModule, MongooseModule.forFeature([{ name: 'Notice', schema: NoticeSchema }])],
	providers: [HelpCenterResolver, HelpCenterService],
})
export class HelpCenterModule {}
