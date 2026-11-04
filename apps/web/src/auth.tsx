import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { API_BASE_URL } from './api.js';

const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080';
const realm = import.meta.env.VITE_KEYCLOAK_REALM ?? 'ai-spend';
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'ia-governanca-web';
const LOCAL_STORAGE_KEY = 'ia-governanca.local-session';

function createManager(): UserManager {
  return new UserManager({
    authority: `${keycloakUrl.replace(/\/$/, '')}/realms/${realm}`,
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: window.location.origin,
    response_type: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

export interface AuthConfig {
  mode: 'local' | 'oidc' | 'both';
  localEnabled: boolean;
  oidcEnabled: boolean;
}

export interface AuthUser {
  access_token: string;
  profile: { name?: string; email?: string };
}

interface LocalSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  mustChangePassword: boolean;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mustChangePassword: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  config: AuthConfig | null;
  loading: boolean;
  error: string | null;
  mustChangePassword: boolean;
  login: () => Promise<void>;
  loginLocal: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeLogin: () => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function authRequest<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `Falha na requisição (${response.status})`);
  return payload as T;
}

function readLocalSession(): LocalSession | null {
  try {
    const raw = window.sessionStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalSession) : null;
  } catch {
    return null;
  }
}

function toLocalSession(tokens: TokenResponse): LocalSession {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    mustChangePassword: tokens.mustChangePassword,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [oidcUser, setOidcUser] = useState<User | null>(null);
  const [local, setLocal] = useState<LocalSession | null>(() => readLocalSession());
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const managerRef = useRef<UserManager | null>(null);

  const storeLocal = useCallback((session: LocalSession | null) => {
    if (session) window.sessionStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(LOCAL_STORAGE_KEY);
    setLocal(session);
  }, []);

  useEffect(() => {
    let active = true;
    let cleanup = () => {};
    (async () => {
      let loaded: AuthConfig;
      try {
        const response = await fetch(`${API_BASE_URL}/auth/config`);
        if (!response.ok) throw new Error('config');
        loaded = (await response.json()) as AuthConfig;
      } catch {
        // API antiga/indisponível: mantém o comportamento original (SSO)
        loaded = { mode: 'oidc', localEnabled: false, oidcEnabled: true };
      }
      if (!active) return;
      setConfig(loaded);
      if (loaded.oidcEnabled) {
        const manager = createManager();
        managerRef.current = manager;
        const onLoaded = (next: User) => { if (active) setOidcUser(next); };
        const onUnloaded = () => { if (active) setOidcUser(null); };
        manager.events.addUserLoaded(onLoaded);
        manager.events.addUserUnloaded(onUnloaded);
        cleanup = () => {
          manager.events.removeUserLoaded(onLoaded);
          manager.events.removeUserUnloaded(onUnloaded);
        };
        try {
          const existing = await manager.getUser();
          if (active) setOidcUser(existing);
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar sessão OIDC');
        }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
      cleanup();
    };
  }, []);

  // Renovação automática do access token local (refresh token rotativo)
  useEffect(() => {
    if (!local) return undefined;
    const delay = Math.max(local.expiresAt - Date.now() - 60_000, 5_000);
    const timer = window.setTimeout(() => {
      authRequest<TokenResponse>('/auth/refresh', { refreshToken: local.refreshToken })
        .then((tokens) => storeLocal(toLocalSession(tokens)))
        .catch(() => storeLocal(null));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [local, storeLocal]);

  const login = useCallback(async () => {
    setError(null);
    if (!managerRef.current) throw new Error('SSO não está habilitado');
    await managerRef.current.signinRedirect();
  }, []);

  const loginLocal = useCallback(async (email: string, password: string) => {
    setError(null);
    storeLocal(toLocalSession(await authRequest<TokenResponse>('/auth/login', { email, password })));
  }, [storeLocal]);

  const logout = useCallback(async () => {
    if (local) {
      await authRequest('/auth/logout', { refreshToken: local.refreshToken }).catch(() => undefined);
      storeLocal(null);
      return;
    }
    await managerRef.current?.signoutRedirect();
  }, [local, storeLocal]);

  const completeLogin = useCallback(async () => {
    if (!managerRef.current) throw new Error('SSO não está habilitado');
    const signedIn = await managerRef.current.signinRedirectCallback();
    setOidcUser(signedIn);
    setError(null);
    return signedIn;
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!local) throw new Error('Sessão local não encontrada');
    await authRequest('/auth/change-password', { currentPassword, newPassword }, local.accessToken);
    storeLocal({ ...local, mustChangePassword: false });
  }, [local, storeLocal]);

  const user = useMemo<AuthUser | null>(() => {
    if (local) return { access_token: local.accessToken, profile: {} };
    if (oidcUser) return { access_token: oidcUser.access_token, profile: { name: oidcUser.profile.name, email: oidcUser.profile.email } };
    return null;
  }, [local, oidcUser]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    config,
    loading,
    error,
    mustChangePassword: local?.mustChangePassword ?? false,
    login,
    loginLocal,
    logout,
    completeLogin,
    changePassword,
  }), [changePassword, completeLogin, config, error, loading, local, login, loginLocal, logout, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
