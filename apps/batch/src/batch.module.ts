import { Module } from '@nestjs/common';
import { BatchController } from './batch.controller';
import { BatchService } from './batch.service';
import {ConfigModule} from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [BatchController],
  providers: [BatchService],
})
export class BatchModule {}
