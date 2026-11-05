import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from './guards/tenant.guard';
import { RolesGuard } from './guards/roles.guard';
import { IdempotencyService } from './idempotency/idempotency.service';
import { LockService } from './concurrency/lock.service';

@Module({
  imports: [AuthModule],
  providers: [TenantGuard, RolesGuard, IdempotencyService, LockService],
  exports: [TenantGuard, RolesGuard, IdempotencyService, LockService, AuthModule],
})
export class CommonModule {}