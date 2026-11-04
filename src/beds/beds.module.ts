import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { BedsController } from './beds.controller';
import { BedsService } from './beds.service';

@Module({
  imports: [CommonModule],
  controllers: [BedsController],
  providers: [BedsService],
  exports: [BedsService],
})
export class BedsModule {}