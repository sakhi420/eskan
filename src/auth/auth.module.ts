import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TenantService } from './tenant.service';
import { LoginThrottleService } from './login-throttle.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    TenantService,
    LoginThrottleService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokenService, TenantService, PasswordService],
})
export class AuthModule {}