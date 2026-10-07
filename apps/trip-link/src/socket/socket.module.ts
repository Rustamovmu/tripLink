import { Module } from '@nestjs/common';
import { AuthModule } from '../components/auth/auth.module';
import { SocketGateway } from './socket.gateway';
import { SocketService } from './socket.service';

@Module({
	imports: [AuthModule],
	providers: [SocketGateway, SocketService],
})
export class SocketModule {}
