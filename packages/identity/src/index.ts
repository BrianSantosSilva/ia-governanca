import { loadEnvConfig, type Role } from '@ia-governanca/contracts';
import { createRemoteJWKSet, jwtVerify, type CryptoKey, type JWTVerifyGetKey } from 'jose';

export const ROLES = ['owner', 'admin', 'finops', 'security', 'developer', 'viewer'] as const;
export type { Role };

export type Permission =
  | 'org:manage'
  | 'org:read'
  | 'members:manage'
  | 'projects:manage'
  | 'projects:read'
  | 'teams:manage'
  | 'teams:read'
  | 'virtual_keys:manage'
  | 'virtual_keys:read'
  | 'virtual_keys:test'
  | 'budgets:manage'
  | 'budgets:read'
  | 'prices:manage'
  | 'costs:read'
  | 'costs:manage'
  | 'connectors:manage'
  | 'connectors:read'
  | 'audit:read'
  | 'prompts:manage'
  | 'prompts:read'
  | 'guardrails:manage'
  | 'guardrails:read';

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    'org:manage',
    'org:read',
    'members:manage',
    'projects:manage',
    'projects:read',
    'teams:manage',
    'teams:read',
    'virtual_keys:manage',
    'virtual_keys:read',
    'virtual_keys:test',
    'budgets:manage',
    'budgets:read',
    'prices:manage',
    'costs:read',
    'costs:manage',
    'connectors:manage',
    'connectors:read',
    'audit:read',
    'prompts:manage',
    'prompts:read',
    'guardrails:manage',
    'guardrails:read',
  ],
  admin: [
    'org:read',
    'members:manage',
    'projects:manage',
    'projects:read',
    'teams:manage',
    'teams:read',
    'virtual_keys:manage',
    'virtual_keys:read',
    'virtual_keys:test',
    'budgets:manage',
    'budgets:read',
    'prices:manage',
    'costs:read',
    'costs:manage',
    'connectors:manage',
    'connectors:read',
    'audit:read',
    'prompts:manage',
    'prompts:read',
    'guardrails:manage',
    'guardrails:read',
  ],
  finops: [
    'org:read',
    'projects:read',
    'teams:read',
    'budgets:manage',
    'budgets:read',
    'prices:manage',
    'costs:read',
    'costs:manage',
    'connectors:manage',
    'connectors:read',
  ],
  security: [
    'org:read',
    'projects:read',
    'teams:read',
    'virtual_keys:read',
    'audit:read',
    'prompts:read',
  ],
  developer: [
    'org:read',
    'projects:read',
    'teams:read',
    'virtual_keys:manage',
    'virtual_keys:read',
    'budgets:read',
  ],
  viewer: [
    'org:read',
    'projects:read',
    'teams:read',
    'budgets:read',
    'costs:read',
    'connectors:read',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export * from './virtual-keys.js';
export * from './passwords.js';
export * from './local-auth.js';

export interface VerifiedIdentityClaims {

  sub: string;
  email: string;
  fullName: string;
  issuer: string;
  audience: string | string[];
}

export interface OidcVerifierOptions {
  issuer?: string;
  audience?: string | string[];
  jwksUrl?: string;
  customKeyOrJwks?: CryptoKey | Uint8Array | JWTVerifyGetKey;
}

let cachedRemoteJwks: JWTVerifyGetKey | null = null;
let cachedJwksUrl: string | null = null;

export async function verifyOidcToken(
  token: string,
  options: OidcVerifierOptions = {},
): Promise<VerifiedIdentityClaims> {
  const env = loadEnvConfig();
  const expectedIssuer =
    options.issuer ?? `${env.KEYCLOAK_BASE_URL}/realms/${env.KEYCLOAK_REALM}`;
  const expectedAudience = options.audience ?? env.KEYCLOAK_CLIENT_ID;

  let keyResolver: CryptoKey | Uint8Array | JWTVerifyGetKey;

  if (options.customKeyOrJwks) {
    keyResolver = options.customKeyOrJwks;
  } else {
    const jwksUri =
      options.jwksUrl ?? `${expectedIssuer}/protocol/openid-connect/certs`;
    if (!cachedRemoteJwks || cachedJwksUrl !== jwksUri) {
      cachedRemoteJwks = createRemoteJWKSet(new URL(jwksUri));
      cachedJwksUrl = jwksUri;
    }
    keyResolver = cachedRemoteJwks;
  }

  const { payload } = await jwtVerify(token, keyResolver as JWTVerifyGetKey, {
    issuer: expectedIssuer,
    audience: expectedAudience,
  });

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('OIDC token missing valid sub claim');
  }

  const email =
    typeof payload.email === 'string' && payload.email.length > 0
      ? payload.email
      : `${payload.sub}@oidc.local`;

  const fullName =
    typeof payload.name === 'string' && payload.name.length > 0
      ? payload.name
      : typeof payload.preferred_username === 'string' && payload.preferred_username.length > 0
        ? payload.preferred_username
        : email;

  return {
    sub: payload.sub,
    email,
    fullName,
    issuer: String(payload.iss),
    audience: payload.aud ?? '',
  };
}
