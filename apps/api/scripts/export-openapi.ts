// Gera openapi.json (contrato usado para gerar clientes Dart/TypeScript)
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApp, swaggerDocument } from '../src/bootstrap';

(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  const doc = swaggerDocument(app);
  writeFileSync('openapi.json', JSON.stringify(doc, null, 2));
  console.log(`openapi.json gerado (${Object.keys(doc.paths).length} rotas)`);
  await app.close();
})();
