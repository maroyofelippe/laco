import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Errors } from './common/errors';
import { config } from './config';

type VErr = { property: string; constraints?: Record<string, string>; children?: VErr[] };
function flattenError(e: VErr): { field: string; message: string }[] {
  const own = Object.values(e.constraints ?? {}).map((m) => ({ field: e.property, message: m }));
  const kids = (e.children ?? []).flatMap((c) => flattenError(c).map((x) => ({ ...x, field: `${e.property}.${x.field}` })));
  return [...own, ...kids];
}

export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: false, exposedHeaders: ['Idempotent-Replayed'] });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => Errors.validation(errors.flatMap(flattenError)),
    }),
  );
  app.enableShutdownHooks();
  return app;
}

export function swaggerDocument(app: INestApplication) {
  const cfg = new DocumentBuilder()
    .setTitle('Laço API')
    .setDescription('Laço — finanças da família, em harmonia. API do app Android e do painel web. Todos os recursos de negócio ficam sob /families/{familyId}; a pessoa precisa ser membro ativo da família.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  return SwaggerModule.createDocument(app, cfg);
}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  if (!config.isProd) SwaggerModule.setup('api/docs', app, swaggerDocument(app), { jsonDocumentUrl: 'api/docs-json' });
  return app;
}
