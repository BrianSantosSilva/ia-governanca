import type pg from 'pg';
import { rollbackAllMigrations } from '@ia-governanca/database';

export async function resetTestDatabase(pool: pg.Pool): Promise<void> {
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name <> 'schema_migrations'`,
  );
  if (tables.rows.length) {
    const names = tables.rows.map(({ table_name }) => `"${table_name.replaceAll('"', '""')}"`);
    await pool.query(`TRUNCATE TABLE ${names.join(', ')} CASCADE`);
  }
  await rollbackAllMigrations(pool);
}
