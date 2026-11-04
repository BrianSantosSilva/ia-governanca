import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// PostgreSQL embarcado (binarios via npm), alternativa ao Docker para desenvolvimento local.
// Le host/porta/usuario/senha/banco de DATABASE_URL e guarda os dados em .data/postgres.
// Uso: npm run db:embedded   (fica em primeiro plano; Ctrl+C encerra com seguranca)

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5432/ai_spend');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`DATABASE_URL aponta para ${url.hostname}; o PostgreSQL embarcado so atende localhost.`);
  }
  const port = Number(url.port || 5432);
  const database = url.pathname.replace(/^\//, '');
  const databaseDir = path.join(root, '.data', 'postgres');

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port,
    persistent: true,
    onLog: () => undefined,
    onError: (message: unknown) => console.error(String(message)),
  });

  if (!fs.existsSync(path.join(databaseDir, 'PG_VERSION'))) {
    console.log('Inicializando o cluster PostgreSQL em .data/postgres ...');
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(database);
    console.log(`Banco '${database}' criado.`);
  } catch {
    // ja existe
  }
  console.log(`PostgreSQL embarcado pronto em localhost:${port} (banco ${database}). Ctrl+C para encerrar.`);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  setInterval(() => undefined, 1 << 30);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
