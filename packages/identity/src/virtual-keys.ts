import crypto from 'node:crypto';

export interface GeneratedVirtualKey {
  apiKey: string;
  keyPrefix: string;
  keyHash: string;
}

/**
 * Gera uma nova chave virtual criptograficamente segura.
 * Formato: `aisp_live_<8_chars_prefix>_<32_bytes_random_hex>`
 */
export function generateVirtualKey(): GeneratedVirtualKey {
  const prefixPart = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  const secretPart = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  const keyPrefix = `aisp_live_${prefixPart}`;
  const apiKey = `${keyPrefix}_${secretPart}`;
  const keyHash = hashVirtualKey(apiKey);

  return {
    apiKey,
    keyPrefix,
    keyHash,
  };
}

/**
 * Calcula o hash SHA-256 da chave virtual para persistência segura no banco.
 */
export function hashVirtualKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
}

/**
 * Compara em tempo constante o hash de uma chave fornecida contra o hash armazenado.
 */
export function verifyVirtualKey(providedKey: string, storedHash: string): boolean {
  if (!providedKey || !storedHash) return false;
  try {
    const computedHash = hashVirtualKey(providedKey);
    const bufComputed = Buffer.from(computedHash, 'hex');
    const bufStored = Buffer.from(storedHash, 'hex');

    if (bufComputed.length !== bufStored.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufComputed, bufStored);
  } catch {
    return false;
  }
}

/**
 * Extrai o prefixo de identificação visual da chave (ex.: `aisp_live_a1b2c3d4`).
 */
export function extractKeyPrefix(apiKey: string): string | null {
  const parts = apiKey.trim().split('_');
  if (parts.length >= 3 && parts[0] === 'aisp' && parts[1] === 'live') {
    return `${parts[0]}_${parts[1]}_${parts[2]}`;
  }
  return null;
}
