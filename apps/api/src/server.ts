import { bootstrapLocalAdmin } from './bootstrap-admin.js';
import { buildApiServer } from './index.js';

async function startApi(): Promise<void> {
  const app = await buildApiServer();
  if ((await bootstrapLocalAdmin()) === 'created') {
    app.log.warn('Administrador inicial criado a partir de BOOTSTRAP_ADMIN_*; a troca de senha será exigida no primeiro login.');
  }
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

startApi().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
