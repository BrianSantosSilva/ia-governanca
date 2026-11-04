import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  '123456789012',
  '1234567890123',
  'qwertyuiop12',
  'qwerty123456',
  'admin1234567',
  'administrator',
  'senha1234567',
  'senha12345678',
  'mudar1234567',
  'changeme1234',
  'letmein12345',
  'iloveyou1234',
  'welcome12345',
  'abcdefghijkl',
  'aaaaaaaaaaaa',
  '111111111111',
  '000000000000',
]);

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N: n, r, p, maxmem: 128 * n * r * 2 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Retorna uma mensagem de erro de política ou `null` quando a senha é aceitável. */
export function validatePasswordPolicy(password: unknown): string | null {
  if (typeof password !== 'string') return 'A senha deve ser um texto';
  if (password.length < PASSWORD_MIN_LENGTH) return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`;
  if (password.length > PASSWORD_MAX_LENGTH) return `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`;
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered) || /^(.)\1+$/.test(password)) return 'Essa senha é muito comum; escolha outra';
  return null;
}

/** Formato: `scrypt$N$r$p$salt(base64)$hash(base64)`. Os parâmetros ficam no hash para permitir migração. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((value) => Number.isInteger(value) && value > 0) || n > 1 << 20 || r > 32 || p > 16) {
    return false;
  }
  try {
    const expected = Buffer.from(parts[5]!, 'base64');
    const actual = await scryptAsync(password, Buffer.from(parts[4]!, 'base64'), n, r, p);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | null = null;

/** Gasta o mesmo tempo de uma verificação real quando o usuário não existe ou não tem senha local. */
export async function burnPasswordVerification(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(password, await dummyHashPromise);
}
