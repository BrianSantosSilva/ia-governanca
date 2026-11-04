import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSensitiveContent, encryptSensitiveContent } from './index.js';

describe('content encryption', () => {
  it('encrypts and decrypts with AES-256-GCM', () => {
    const key = randomBytes(32).toString('hex');
    const encrypted = encryptSensitiveContent('synthetic prompt', key);

    expect(encrypted.ciphertext.toString()).not.toContain('synthetic prompt');
    expect(decryptSensitiveContent(encrypted, key)).toBe('synthetic prompt');
  });

  it('rejects invalid keys and tampered content', () => {
    expect(() => encryptSensitiveContent('x', 'bad')).toThrow(/64 caracteres/);
    const encrypted = encryptSensitiveContent('synthetic prompt', randomBytes(32).toString('hex'));
    encrypted.ciphertext[0] ^= 0xff;
    expect(() =>
      decryptSensitiveContent(encrypted, randomBytes(32).toString('hex')),
    ).toThrow();
  });
});
