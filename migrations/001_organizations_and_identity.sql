-- Up Migration: 001_organizations_and_identity

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  oidc_subject TEXT UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'finops', 'security', 'developer', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, user_id),
  UNIQUE (id, organization_id)
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, slug),
  UNIQUE (id, organization_id)
);

CREATE TABLE team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  team_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id),
  CONSTRAINT fk_team_memberships_team_org
    FOREIGN KEY (team_id, organization_id)
    REFERENCES teams(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_team_memberships_user_org
    FOREIGN KEY (user_id, organization_id)
    REFERENCES memberships(user_id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  team_id UUID,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, slug),
  UNIQUE (id, organization_id),
  CONSTRAINT fk_projects_team_org
    FOREIGN KEY (team_id, organization_id)
    REFERENCES teams(id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_memberships_org_user ON memberships(organization_id, user_id);
CREATE INDEX idx_teams_org ON teams(organization_id);
CREATE INDEX idx_projects_org ON projects(organization_id);

-- Down Migration
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS team_memberships;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organizations;
