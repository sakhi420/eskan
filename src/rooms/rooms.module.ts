import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { BedsModule } from '../beds/beds.module';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [CommonModule, BedsModule],
  controllers: [RoomsController],
  providers: [RoomsService],
})
export class RoomsModule {}
