import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration, { validate } from './common/config/configuration';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './database/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}