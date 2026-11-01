import './env';

export default async function globalSetup() {
  const { migrate } = await import('../src/db/migrate');
  await migrate({ reset: true, silent: true });
}
