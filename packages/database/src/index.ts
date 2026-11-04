import { loadEnvConfig } from '@ia-governanca/contracts';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
export {
  purgeExpiredAuditEvents,
  purgeExpiredGuardrailData,
  purgeExpiredUsageEventContent,
  failInterruptedGuardrailEvaluations,
} from './retention.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export function getPool(connectionString?: string): pg.Pool {
  if (!poolInstance) {
    const url = connectionString ?? loadEnvConfig().DATABASE_URL;
    poolInstance = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return poolInstance;
}

export async function checkDatabaseConnection(customPool?: pg.Pool): Promise<boolean> {
  const pool = customPool ?? getPool();
  const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

export interface MigrationSection {
  name: string;
  upSql: string;
  downSql: string;
}

export function loadSqlMigrations(migrationsDir?: string): MigrationSection[] {
  const dir = migrationsDir ?? path.resolve(process.cwd(), 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((file) => {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const [upPart, downPart] = raw.split(/--\s*Down Migration/i);
    return {
      name: file,
      upSql: (upPart ?? '').trim(),
      downSql: (downPart ?? '').trim(),
    };
  });
}

export async function applyMigrations(customPool?: pg.Pool, migrationsDir?: string): Promise<string[]> {
  const pool = customPool ?? getPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedRes = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const appliedSet = new Set(appliedRes.rows.map((r) => r.name));
    const migrations = loadSqlMigrations(migrationsDir);
    const newlyApplied: string[] = [];

    for (const m of migrations) {
      if (!appliedSet.has(m.name)) {
        await client.query('BEGIN');
        try {
          await client.query(m.upSql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
          await client.query('COMMIT');
          newlyApplied.push(m.name);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    }
    return newlyApplied;
  } finally {
    client.release();
  }
}

export async function rollbackAllMigrations(customPool?: pg.Pool, migrationsDir?: string): Promise<string[]> {
  const pool = customPool ?? getPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedRes = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name DESC',
    );
    const appliedNames = appliedRes.rows.map((r) => r.name);
    const migrationsMap = new Map(loadSqlMigrations(migrationsDir).map((m) => [m.name, m]));
    const rolledBack: string[] = [];

    for (const name of appliedNames) {
      const m = migrationsMap.get(name);
      if (m && m.downSql) {
        await client.query('BEGIN');
        try {
          await client.query(m.downSql);
          await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
          await client.query('COMMIT');
          rolledBack.push(name);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    }
    return rolledBack;
  } finally {
    client.release();
  }
}
