import { applyMigrations, closePool, rollbackAllMigrations } from './index.js';

const direction = process.argv[2] ?? 'up';

async function main() {
  try {
    if (direction === 'down') {
      const rolled = await rollbackAllMigrations();
      console.log('Migrations revertidas:', rolled);
    } else {
      const applied = await applyMigrations();
      console.log('Migrations aplicadas:', applied);
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error('Erro ao executar migrações:', err);
  process.exit(1);
});
