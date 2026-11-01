import { createApp } from './bootstrap';
import { config } from './config';

async function main() {
  const app = await createApp();
  await app.listen(config.port);
  console.log(`Laço API em http://localhost:${config.port}/api/v1  ·  docs: http://localhost:${config.port}/api/docs`);
}

main();
