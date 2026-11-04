import { getPool } from '@ia-governanca/database';
import { hashPassword, resolveAuthConfig, validatePasswordPolicy } from '@ia-governanca/identity';
import type pg from 'pg';

export type BootstrapResult = 'skipped' | 'created';

// Cria o primeiro usuário local apenas quando ainda não existe nenhum usuário com senha.
export async function bootstrapLocalAdmin(
  env: NodeJS.ProcessEnv = process.env,
  pool: pg.Pool = getPool(),
): Promise<BootstrapResult> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return 'skipped';
  if (!resolveAuthConfig(env).localEnabled) return 'skipped';

  const policyError = validatePasswordPolicy(password);
  if (policyError) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD inválida: ${policyError}`);

  const existing = await pool.query(`SELECT 1 FROM users WHERE password_hash IS NOT NULL LIMIT 1`);
  if ((existing.rowCount ?? 0) > 0) return 'skipped';

  await pool.query(
    `INSERT INTO users (email, full_name, password_hash, password_changed_at, must_change_password)
     VALUES ($1, $2, $3, NOW(), TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, password_changed_at = NOW(),
           must_change_password = TRUE, updated_at = NOW()`,
    [email, email.split('@')[0] ?? email, await hashPassword(password)],
  );
  return 'created';
}
