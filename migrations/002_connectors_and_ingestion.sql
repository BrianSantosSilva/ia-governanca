-- Up Migration: 002_connectors_and_ingestion

CREATE TABLE provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('api', 'csv')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  config_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  encrypted_credentials TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id)
);

CREATE TABLE sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provider_connection_id UUID,
  dataset TEXT NOT NULL CHECK (dataset IN ('api_costs', 'usage_records', 'license_assignments')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial', 'dry_run')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  records_processed INTEGER NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
  records_created INTEGER NOT NULL DEFAULT 0 CHECK (records_created >= 0),
  records_updated INTEGER NOT NULL DEFAULT 0 CHECK (records_updated >= 0),
  records_failed INTEGER NOT NULL DEFAULT 0 CHECK (records_failed >= 0),
  checkpoint JSONB,
  error_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  UNIQUE (id, organization_id),
  CONSTRAINT fk_sync_runs_connection_org
    FOREIGN KEY (provider_connection_id, organization_id)
    REFERENCES provider_connections(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sync_run_id UUID NOT NULL,
  provider_connection_id UUID,
  provider TEXT NOT NULL,
  dataset TEXT NOT NULL CHECK (dataset IN ('api_costs', 'usage_records', 'license_assignments')),
  external_id TEXT NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, provider, dataset, external_id),
  CONSTRAINT fk_source_records_sync_run_org
    FOREIGN KEY (sync_run_id, organization_id)
    REFERENCES sync_runs(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_source_records_connection_org
    FOREIGN KEY (provider_connection_id, organization_id)
    REFERENCES provider_connections(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE external_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_email TEXT,
  display_name TEXT,
  user_id UUID,
  match_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (match_status IN ('matched', 'pending_review', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, provider, external_user_id),
  CONSTRAINT fk_external_identities_user_org
    FOREIGN KEY (user_id, organization_id)
    REFERENCES memberships(user_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_sync_runs_org_status ON sync_runs(organization_id, status);
CREATE INDEX idx_source_records_org_provider ON source_records(organization_id, provider, dataset);
CREATE INDEX idx_external_identities_org_status ON external_identities(organization_id, match_status);

-- Down Migration
DROP TABLE IF EXISTS external_identities;
DROP TABLE IF EXISTS source_records;
DROP TABLE IF EXISTS sync_runs;
DROP TABLE IF EXISTS provider_connections;
