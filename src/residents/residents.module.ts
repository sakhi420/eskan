import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { ContractsModule } from '../contracts/contracts.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { ResidentsController } from './residents.controller';
import { ResidentsService } from './residents.service';

@Module({
  imports: [CommonModule, ContractsModule, AssignmentsModule],
  controllers: [ResidentsController],
  providers: [ResidentsService],
  exports: [ResidentsService],
})
export class ResidentsModule {}
