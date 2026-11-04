import readline from 'node:readline';
import { closePool, getPool } from '../packages/database/src/index.ts';
import { hashPassword, validatePasswordPolicy } from '../packages/identity/src/passwords.ts';

// Uso: npx tsx scripts/create-user.ts --email a@b.com --name "Nome" [--role owner] [--org slug]
// A senha é lida sem eco (ou da stdin quando não há TTY). Nunca é aceita por argumento.

const ROLES = ['owner', 'admin', 'finops', 'security', 'developer', 'viewer'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', (line) => {
        rl.close();
        resolve(line);
      });
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name') ?? email;
  const role = arg('role');
  const orgSlug = arg('org');
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Informe --email válido.');
  if (role && !ROLES.includes(role)) throw new Error(`--role deve ser um de: ${ROLES.join(', ')}`);
  if (orgSlug && !role) throw new Error('--org exige --role.');

  const password = await readSecret('Senha: ');
  const policyError = validatePasswordPolicy(password);
  if (policyError) throw new Error(policyError);
  if (process.stdin.isTTY && (await readSecret('Confirme a senha: ')) !== password) throw new Error('As senhas não conferem.');

  const pool = getPool();
  const hash = await hashPassword(password);
  const userId = (
    await pool.query(
      `INSERT INTO users (email, full_name, password_hash, password_changed_at, must_change_password)
       VALUES ($1, $2, $3, NOW(), FALSE)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, password_changed_at = NOW(),
             failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
       RETURNING id`,
      [email, name, hash],
    )
  ).rows[0].id as string;
  await pool.query(
    `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );

  if (role) {
    const orgs = (await pool.query(`SELECT id, slug FROM organizations WHERE deleted_at IS NULL ORDER BY created_at`)).rows;
    let orgId: string | undefined;
    if (orgSlug) orgId = orgs.find((o) => o.slug === orgSlug)?.id;
    else if (orgs.length === 1) orgId = orgs[0].id;
    else if (orgs.length === 0) {
      orgId = (await pool.query(`INSERT INTO organizations (name, slug) VALUES ('Organização Padrão', 'default') RETURNING id`)).rows[0].id;
    } else throw new Error('Existem várias organizações: informe --org <slug>.');
    if (!orgId) throw new Error(`Organização '${orgSlug}' não encontrada.`);
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, deleted_at = NULL, updated_at = NOW()`,
      [orgId, userId, role],
    );
  }
  console.log(`Usuário ${email} pronto para login local${role ? ` (papel ${role})` : ''}.`);
}

main()
  .catch((error: unknown) => {
    console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
