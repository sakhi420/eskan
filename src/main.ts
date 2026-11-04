import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, HttpStatus } from '@nestjs/common';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`ESKAN backend listening on :${port}`, 'Bootstrap');
}
void bootstrap();