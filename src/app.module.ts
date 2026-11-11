import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import configuration, { validate } from './common/config/configuration';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { HostelsModule } from './hostels/hostels.module';
import { RoomsModule } from './rooms/rooms.module';
import { BedsModule } from './beds/beds.module';
import { PackagesModule } from './packages/packages.module';
import { ResidentsModule } from './residents/residents.module';
import { ContractsModule } from './contracts/contracts.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { ChargesModule } from './charges/charges.module';
import { PaymentsModule } from './payments/payments.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TraceIdMiddleware } from './common/middleware/trace-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    HostelsModule,
    RoomsModule,
    BedsModule,
    PackagesModule,
    ResidentsModule,
    ContractsModule,
    AssignmentsModule,
    ChargesModule,
    PaymentsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('*');
  }
}