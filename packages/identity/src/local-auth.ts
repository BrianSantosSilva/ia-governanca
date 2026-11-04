import crypto from 'node:crypto';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';

export const LOCAL_ISSUER = 'ia-governanca-local';
export const LOCAL_AUDIENCE = 'ia-governanca-local-api';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const SESSION_ABSOLUTE_TTL_SECONDS = 8 * 60 * 60;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export type AuthMode = 'local' | 'oidc' | 'both';

export interface ResolvedAuthConfig {
  mode: AuthMode;
  localEnabled: boolean;
  oidcEnabled: boolean;
  localJwtSecret: string | null;
}

export interface AuthEnvInput {
  AUTH_MODE?: string;
  AUTH_LOCAL_JWT_SECRET?: string;
  KEYCLOAK_BASE_URL?: string;
  NODE_ENV?: string;
  AUTH_LOCAL_ALLOW_IN_PRODUCTION?: string;
}

/**
 * Sem AUTH_MODE: `local` quando o Keycloak não está configurado; `both` quando está (e há segredo local);
 * `oidc` quando o Keycloak está configurado mas o segredo local não, preservando ambientes existentes.
 */
export function resolveAuthConfig(env: AuthEnvInput, overrides: { mode?: AuthMode; localJwtSecret?: string } = {}): ResolvedAuthConfig {
  const secret = overrides.localJwtSecret ?? env.AUTH_LOCAL_JWT_SECRET ?? null;
  const explicit = overrides.mode ?? (env.AUTH_MODE as AuthMode | undefined);
  if (explicit && !['local', 'oidc', 'both'].includes(explicit)) {
    throw new Error(`AUTH_MODE inválido: ${explicit}. Use local, oidc ou both.`);
  }
  const hasKeycloak = Boolean(env.KEYCLOAK_BASE_URL);
  const mode: AuthMode = explicit ?? (hasKeycloak ? (secret ? 'both' : 'oidc') : 'local');
  const localEnabled = mode === 'local' || mode === 'both';
  if (localEnabled) {
    if (!secret || secret.length < 32) {
      throw new Error('AUTH_LOCAL_JWT_SECRET (mínimo de 32 caracteres) é obrigatório quando o login local está habilitado.');
    }
    if (env.NODE_ENV === 'production' && env.AUTH_LOCAL_ALLOW_IN_PRODUCTION !== 'true') {
      throw new Error('Login local em produção exige AUTH_LOCAL_ALLOW_IN_PRODUCTION=true.');
    }
  }
  return { mode, localEnabled, oidcEnabled: mode === 'oidc' || mode === 'both', localJwtSecret: localEnabled ? secret : null };
}

export interface LocalTokenClaims {
  userId: string;
  familyId: string;
}

function keyFrom(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signLocalAccessToken(secret: string, claims: LocalTokenClaims): Promise<string> {
  return new SignJWT({ fam: claims.familyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(LOCAL_ISSUER)
    .setAudience(LOCAL_AUDIENCE)
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(keyFrom(secret));
}

export async function verifyLocalAccessToken(secret: string, token: string): Promise<LocalTokenClaims> {
  const { payload } = await jwtVerify(token, keyFrom(secret), {
    issuer: LOCAL_ISSUER,
    audience: LOCAL_AUDIENCE,
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.fam !== 'string') {
    throw new Error('Token local inválido');
  }
  return { userId: payload.sub, familyId: payload.fam };
}

/** Lê o emissor sem validar a assinatura; serve só para escolher o verificador, que valida tudo. */
export function peekTokenIssuer(token: string): string | null {
  try {
    const iss = decodeJwt(token).iss;
    return typeof iss === 'string' ? iss : null;
  } catch {
    return null;
  }
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
