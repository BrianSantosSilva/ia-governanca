import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedContent {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

export function redactKnownSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|aisp_(?:live|test)_[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g,
      '[REDACTED]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=[REDACTED]',
    )
    .replace(/:\/\/([^:/\s]+):([^@/\s]+)@/g, '://$1:[REDACTED]@');
}

function decodeKey(keyHex: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) {
    throw new Error('PROMPT_CONTENT_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais');
  }
  return Buffer.from(keyHex, 'hex');
}

export function encryptSensitiveContent(plaintext: string, keyHex: string): EncryptedContent {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeKey(keyHex), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

export function decryptSensitiveContent(
  encrypted: EncryptedContent,
  keyHex: string,
): string {
  const decipher = createDecipheriv('aes-256-gcm', decodeKey(keyHex), encrypted.nonce);
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
