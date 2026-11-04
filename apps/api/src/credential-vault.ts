import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function getEncryptionKey(): Buffer {
  const configured = process.env.CONNECTOR_CREDENTIALS_KEY;
  if (!configured || !/^[a-fA-F0-9]{64}$/.test(configured)) {
    throw new Error('CONNECTOR_CREDENTIALS_KEY deve ser configurada como 64 caracteres hexadecimais');
  }
  return Buffer.from(configured, 'hex');
}

export function encryptConnectorCredentials(credentials: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptConnectorCredentials(encrypted: string): Record<string, unknown> {
  const [version, encodedIv, encodedTag, encodedData] = encrypted.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedData) {
    throw new Error('Formato de credencial criptografada inválido');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(encodedIv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedData, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  const value: unknown = JSON.parse(plaintext);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Credenciais descriptografadas possuem formato inválido');
  }
  return value as Record<string, unknown>;
}
