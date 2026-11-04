import { describe, expect, it } from 'vitest';
import {
  decryptSensitiveContent,
  encryptSensitiveContent,
  redactKnownSecrets,
} from '../../packages/secure-content/src/index.js';

describe('Criptografia do conteúdo de inferência', () => {
  const key = 'a'.repeat(64);

  it('cifra e decifra conteúdo com nonces distintos', () => {
    const first = encryptSensitiveContent('prompt e resposta', key);
    const second = encryptSensitiveContent('prompt e resposta', key);

    expect(decryptSensitiveContent(first, key)).toBe('prompt e resposta');
    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.ciphertext.equals(Buffer.from('prompt e resposta'))).toBe(false);
  });

  it('rejeita conteúdo alterado e chaves inválidas', () => {
    const encrypted = encryptSensitiveContent('conteúdo privado', key);
    encrypted.ciphertext[0] = encrypted.ciphertext[0]! ^ 1;

    expect(() => decryptSensitiveContent(encrypted, key)).toThrow();
    expect(() => encryptSensitiveContent('conteúdo', 'invalid')).toThrow();
  });

  it('remove formatos comuns de credenciais antes de armazenar conteúdo', () => {
    const secrets = [
      `AIza${'A'.repeat(35)}`,
      `ghp_${'a'.repeat(30)}`,
      `AKIA${'A'.repeat(16)}`,
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
    ];
    const input = [
      ...secrets,
      'Bearer synthetic-token',
      'api_key="synthetic-key"',
      'https://user:synthetic-password@example.test/path',
    ].join(' ');
    const redacted = redactKnownSecrets(input);

    for (const secret of secrets) expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain('synthetic-token');
    expect(redacted).not.toContain('synthetic-key');
    expect(redacted).not.toContain('synthetic-password');
  });
});
