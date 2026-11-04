import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { HostelsController } from './hostels.controller';
import { HostelsService } from './hostels.service';

@Module({
  imports: [CommonModule],
  controllers: [HostelsController],
  providers: [HostelsService],
})
export class HostelsModule {}