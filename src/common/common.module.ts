import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from './guards/tenant.guard';
import { RolesGuard } from './guards/roles.guard';
import { IdempotencyService } from './idempotency/idempotency.service';

@Module({
  imports: [AuthModule],
  providers: [TenantGuard, RolesGuard, IdempotencyService],
  exports: [TenantGuard, RolesGuard, IdempotencyService, AuthModule],
})
export class CommonModule {}