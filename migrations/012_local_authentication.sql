-- Up Migration: 012_local_authentication

ALTER TABLE users
  ADD COLUMN password_hash TEXT,
  ADD COLUMN password_changed_at TIMESTAMPTZ,
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  ADD COLUMN locked_until TIMESTAMPTZ;

-- Cada login cria uma "família" de sessão; o refresh token é rotacionado dentro dela.
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE CHECK (length(refresh_token_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT CHECK (revoked_reason IS NULL OR revoked_reason IN ('rotated', 'logout', 'reuse_detected', 'password_changed', 'password_reset', 'user_disabled')),
  rotated_from_id UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 200)
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_family_active ON auth_sessions(family_id) WHERE revoked_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_auth_sessions_family_active;
DROP INDEX IF EXISTS idx_auth_sessions_user;
DROP TABLE IF EXISTS auth_sessions;
ALTER TABLE users
  DROP COLUMN IF EXISTS locked_until,
  DROP COLUMN IF EXISTS failed_login_attempts,
  DROP COLUMN IF EXISTS must_change_password,
  DROP COLUMN IF EXISTS password_changed_at,
  DROP COLUMN IF EXISTS password_hash;
