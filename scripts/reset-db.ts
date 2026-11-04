import crypto from 'node:crypto';
import { getPool, closePool } from '../packages/database/src/index.ts';
import { hashVirtualKey } from '../packages/identity/src/virtual-keys.ts';
import { hashPassword } from '../packages/identity/src/passwords.ts';

// Senha fixa apenas para o seed de desenvolvimento (login local).
const DEV_PASSWORD = 'DevLocal#2026-Acme';

// Reset de DESENVOLVIMENTO: apaga os dados de todas as tabelas (exceto schema_migrations)
// e recria um cenário de teste com chaves virtuais FIXAS. Nunca use em produção.

const ORG = { name: 'Acme Gateway', slug: 'acme-gateway' };

interface SeedKey {
  name: string;
  prefix: string;
  secretSeed: string;
  providers: string[];
  models: string[];
}

// Os segredos são derivados de uma semente fixa: a mesma chave é gerada a cada reset.
function fixedKey(prefix: string, secretSeed: string): string {
  const secret = crypto.createHash('sha256').update(`ia-governanca-dev:${secretSeed}`).digest('hex').slice(0, 48);
  return `aisp_live_${prefix}_${secret}`;
}

const KEYS: SeedKey[] = [
  { name: 'Dev Ollama llama3.2', prefix: 'dev00001', secretSeed: 'llama32', providers: ['ollama'], models: ['llama3.2'] },
  { name: 'Dev Ollama qwen2.5:7b', prefix: 'dev00002', secretSeed: 'qwen25-7b', providers: ['ollama'], models: ['qwen2.5:7b'] },
  { name: 'Dev Foundry Phi-4-mini', prefix: 'dev00003', secretSeed: 'phi4-mini', providers: ['azure-openai'], models: ['Phi-4-mini-instruct'] },
  { name: 'Dev Foundry gpt-4.1-mini', prefix: 'dev00004', secretSeed: 'gpt41-mini', providers: ['azure-openai'], models: ['gpt-4.1-mini'] },
  {
    name: 'Dev Todos os modelos',
    prefix: 'dev00005',
    secretSeed: 'all-models',
    providers: ['ollama', 'azure-openai'],
    models: ['llama3.2', 'qwen2.5:7b', 'Phi-4-mini-instruct', 'gpt-4.1-mini'],
  },
  {
    name: 'Dev Orçamento baixo (block)',
    prefix: 'dev00006',
    secretSeed: 'low-budget',
    providers: ['ollama'],
    models: ['llama3.2', 'qwen2.5:7b'],
  },
];

// Preços FICTÍCIOS (USD por milhão de tokens) apenas para testes locais.
const PRICES = [
  { provider: 'ollama', model: 'llama3.2', input: 0.1, output: 0.2, source: 'internal_simulation', type: 'simulation' },
  { provider: 'ollama', model: 'qwen2.5:7b', input: 0.15, output: 0.3, source: 'internal_simulation', type: 'simulation' },
  { provider: 'azure-openai', model: 'Phi-4-mini-instruct', input: 0.075, output: 0.3, source: 'internal_simulation', type: 'simulation' },
  { provider: 'azure-openai', model: 'gpt-4.1-mini', input: 0.4, output: 1.6, source: 'internal_simulation', type: 'internal_estimate' },
];

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    console.error('Este comando APAGA todos os dados do banco. Rode novamente com --yes para confirmar.');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('Recusado: NODE_ENV=production.');
    process.exit(1);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const db = await client.query('SELECT current_database() AS db');
    console.log(`Banco: ${db.rows[0].db}`);

    await client.query('BEGIN');
    const tables = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
    );
    const list = tables.rows.map((r) => `"${r.tablename}"`).join(', ');
    await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

    const org = (
      await client.query(`INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`, [ORG.name, ORG.slug])
    ).rows[0].id as string;
    // E-mails iguais aos usuários do realm Keycloak (owner/finops/viewer): o login casa o usuário pelo e-mail.
    const members = [
      { email: 'owner@acme.local', name: 'Owner Acme', role: 'owner' },
      { email: 'finops@acme.local', name: 'FinOps Acme', role: 'finops' },
      { email: 'viewer@acme.local', name: 'Viewer Acme', role: 'viewer' },
    ];
    const devPasswordHash = await hashPassword(DEV_PASSWORD);
    let user = '';
    for (const m of members) {
      const u = (
        await client.query(`INSERT INTO users (email, full_name, password_hash, password_changed_at) VALUES ($1, $2, $3, NOW()) RETURNING id`, [m.email, m.name, devPasswordHash])
      ).rows[0].id as string;
      await client.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, u, m.role]);
      if (m.role === 'owner') user = u;
    }
    const project = (
      await client.query(
        `INSERT INTO projects (organization_id, name, slug, description)
         VALUES ($1, 'Testes Locais', 'testes-locais', 'Projeto de testes do ambiente de desenvolvimento') RETURNING id`,
        [org],
      )
    ).rows[0].id as string;

    const priceIds = new Map<string, string>();
    for (const p of PRICES) {
      const r = await client.query(
        `INSERT INTO model_prices (organization_id, provider, model, currency, input_price_per_million,
           output_price_per_million, price_source, price_type, effective_from)
         VALUES (NULL, $1, $2, 'USD', $3, $4, $5, $6, '2020-01-01T00:00:00Z') RETURNING id`,
        [p.provider, p.model, p.input, p.output, p.source, p.type],
      );
      priceIds.set(p.model, r.rows[0].id);
    }

    const keyIds = new Map<string, string>();
    const printed: Array<{ name: string; models: string; key: string }> = [];
    for (const k of KEYS) {
      const apiKey = fixedKey(k.prefix, k.secretSeed);
      const r = await client.query(
        `INSERT INTO virtual_keys (organization_id, project_id, created_by_user_id, name, key_prefix, key_hash,
           allowed_providers, allowed_models, scopes, scope_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ARRAY['chat:completions']::TEXT[], 'project') RETURNING id`,
        [org, project, user, k.name, `aisp_live_${k.prefix}`, hashVirtualKey(apiKey), k.providers, k.models],
      );
      keyIds.set(k.prefix, r.rows[0].id);
      printed.push({ name: k.name, models: k.models.join(', '), key: apiKey });
    }

    // Orçamentos: um limite amplo para a organização e um mínimo (block) para a chave de teste de bloqueio.
    await client.query(
      `INSERT INTO budget_policies (organization_id, scope_type, name, mode, currency, limit_amount,
         alert_threshold_percent, period_start, period_end)
       VALUES ($1, 'organization', 'Org mensal (alert)', 'alert', 'USD', 50, 80, '2026-01-01T00:00:00Z', '2036-01-01T00:00:00Z')`,
      [org],
    );
    await client.query(
      `INSERT INTO budget_policies (organization_id, scope_type, virtual_key_id, name, mode, currency, limit_amount,
         alert_threshold_percent, period_start, period_end)
       VALUES ($1, 'virtual_key', $2, 'Chave orçamento baixo (block)', 'block', 'USD', 0.0002, 80,
               '2026-01-01T00:00:00Z', '2036-01-01T00:00:00Z')`,
      [org, keyIds.get('dev00006')],
    );

    // Guardrail determinístico (palavras proibidas) em modo runtime: bloqueia antes de chamar o provedor.
    await client.query(
      `INSERT INTO guardrail_rules (organization_id, name, description, rule_type, mode, scope_type, terms,
         severity, created_by_user_id)
       VALUES ($1, 'Bad words', 'Bloqueia palavras ofensivas (teste)', 'deterministic', 'runtime', 'organization',
               ARRAY['bobão', 'feio', 'fdp']::TEXT[], 'high', $2)`,
      [org, user],
    );

    // Guardrail inteligente assíncrono: o gpt-4.1-mini classifica depois da resposta, sem bloquear a requisição.
    await client.query(
      `INSERT INTO guardrail_rules (organization_id, name, description, rule_type, mode, scope_type,
         evaluator_provider, evaluator_model, evaluator_prompt, severity, created_by_user_id)
       VALUES ($1, 'Contexto político', 'Detecta conversas de contexto político (teste)', 'intelligent', 'async',
               'organization', 'azure-openai', 'gpt-4.1-mini', $2, 'medium', $3)`,
      [
        org,
        'Você é um classificador. Responda "block" se a mensagem tratar de política: partidos, candidatos, eleições, governos, políticos, ideologias políticas ou debates políticos. Responda "allow" caso contrário.',
        user,
      ],
    );

    // Histórico fictício para popular o dashboard.
    const history = [
      { daysAgo: 6, key: 'dev00001', model: 'llama3.2', provider: 'ollama', inT: 1200, outT: 300 },
      { daysAgo: 5, key: 'dev00002', model: 'qwen2.5:7b', provider: 'ollama', inT: 14500, outT: 120 },
      { daysAgo: 4, key: 'dev00003', model: 'Phi-4-mini-instruct', provider: 'azure-openai', inT: 7500, outT: 200 },
      { daysAgo: 3, key: 'dev00004', model: 'gpt-4.1-mini', provider: 'azure-openai', inT: 12700, outT: 30 },
      { daysAgo: 2, key: 'dev00004', model: 'gpt-4.1-mini', provider: 'azure-openai', inT: 25400, outT: 43 },
      { daysAgo: 1, key: 'dev00005', model: 'llama3.2', provider: 'ollama', inT: 900, outT: 250 },
    ];
    for (const h of history) {
      const price = PRICES.find((p) => p.model === h.model)!;
      const amount = (h.inT * price.input + h.outT * price.output) / 1_000_000;
      const at = new Date(Date.now() - h.daysAgo * 86_400_000);
      const ev = await client.query(
        `INSERT INTO usage_events (organization_id, project_id, virtual_key_id, request_id, provider, model,
           input_tokens, output_tokens, duration_ms, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1500, 'succeeded', $9) RETURNING id`,
        [org, project, keyIds.get(h.key), crypto.randomUUID(), h.provider, h.model, h.inT, h.outT, at],
      );
      await client.query(
        `INSERT INTO cost_records (organization_id, project_id, usage_event_id, model_price_id, provider, model,
           cost_category, is_simulated, currency, amount, period_start, period_end, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'gateway_estimated', TRUE, 'USD', $7, $8, $8, $8)`,
        [org, project, ev.rows[0].id, priceIds.get(h.model), h.provider, h.model, amount.toFixed(8), at],
      );
    }

    await client.query('COMMIT');
    console.log(`\nOrganização: ${ORG.name} (${org})\nProjeto: Testes Locais (${project})`);
    console.log(`Login local: owner@acme.local | finops@acme.local | viewer@acme.local  — senha: ${DEV_PASSWORD}\n`);
    console.table(printed);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
