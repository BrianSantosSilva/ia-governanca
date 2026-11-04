import { loadEnvConfig } from '@ia-governanca/contracts';
import { checkDatabaseConnection, closePool } from '@ia-governanca/database';
import { afterAll, describe, expect, it } from 'vitest';

describe('Épico 01 — Ambiente Local e Conexão PostgreSQL', () => {
  afterAll(async () => {
    await closePool();
  });

  it('deve validar as variáveis de ambiente via Zod (EnvSchema)', () => {
    const config = loadEnvConfig();
    expect(config.DATABASE_URL).toContain('ai_spend');
    expect(config.OLLAMA_MODEL).toBe('llama3.2');
    expect(config.KEYCLOAK_REALM).toBe('ai-spend');
  });

  it('deve abrir uma conexão real com o PostgreSQL e executar SELECT 1', async () => {
    const isConnected = await checkDatabaseConnection();
    expect(isConnected).toBe(true);
  });
});
