-- Up Migration: 004_gateway_and_finance

CREATE TABLE virtual_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL,
  created_by_user_id UUID,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE CHECK (length(key_hash) >= 64),
  allowed_providers TEXT[] NOT NULL DEFAULT ARRAY['ollama']::TEXT[],
  allowed_models TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  scopes TEXT[] NOT NULL DEFAULT ARRAY['chat:completions']::TEXT[],
  max_requests_per_minute INTEGER CHECK (max_requests_per_minute IS NULL OR max_requests_per_minute > 0),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  UNIQUE (id, project_id, organization_id),
  CONSTRAINT fk_virtual_keys_project_org
    FOREIGN KEY (project_id, organization_id)
    REFERENCES projects(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_virtual_keys_creator_org
    FOREIGN KEY (created_by_user_id, organization_id)
    REFERENCES memberships(user_id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL,
  virtual_key_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'blocked_policy', 'blocked_budget', 'uncertain')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, request_id, attempt_number),
  CONSTRAINT fk_usage_events_project_org
    FOREIGN KEY (project_id, organization_id)
    REFERENCES projects(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_usage_events_vkey_project_org
    FOREIGN KEY (virtual_key_id, project_id, organization_id)
    REFERENCES virtual_keys(id, project_id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE model_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  input_price_per_million NUMERIC(18, 8) NOT NULL CHECK (input_price_per_million >= 0),
  output_price_per_million NUMERIC(18, 8) NOT NULL CHECK (output_price_per_million >= 0),
  price_source TEXT NOT NULL CHECK (price_source IN ('official_pricing_table', 'internal_simulation', 'custom_contract')),
  price_type TEXT NOT NULL CHECK (price_type IN ('commercial_api_tariff', 'internal_estimate', 'simulation')),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_model_prices_effective_range
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE cost_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id UUID,
  usage_event_id UUID,
  source_record_id UUID,
  license_assignment_id UUID,
  model_price_id UUID REFERENCES model_prices(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  model TEXT,
  cost_category TEXT NOT NULL CHECK (cost_category IN (
    'gateway_estimated',
    'provider_reported',
    'license_contracted',
    'financial_adjustment',
    'unreconciled'
  )),
  is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount NUMERIC(18, 8) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  CONSTRAINT fk_cost_records_project_org
    FOREIGN KEY (project_id, organization_id)
    REFERENCES projects(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_cost_records_usage_event_org
    FOREIGN KEY (usage_event_id, organization_id)
    REFERENCES usage_events(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_cost_records_source_record_org
    FOREIGN KEY (source_record_id, organization_id)
    REFERENCES source_records(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_cost_records_license_assignment_org
    FOREIGN KEY (license_assignment_id, organization_id)
    REFERENCES license_assignments(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE reconciliation_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  estimated_cost_record_id UUID,
  reported_cost_record_id UUID,
  status TEXT NOT NULL CHECK (status IN ('matched', 'divergent', 'unreconciled')),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  delta_amount NUMERIC(18, 8) NOT NULL DEFAULT 0,
  notes TEXT,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  CONSTRAINT fk_reconciliation_estimated_org
    FOREIGN KEY (estimated_cost_record_id, organization_id)
    REFERENCES cost_records(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_reconciliation_reported_org
    FOREIGN KEY (reported_cost_record_id, organization_id)
    REFERENCES cost_records(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE budget_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('organization', 'project', 'virtual_key')),
  project_id UUID,
  virtual_key_id UUID,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('observe', 'alert', 'block')),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  limit_amount NUMERIC(18, 6) NOT NULL CHECK (limit_amount > 0),
  alert_threshold_percent NUMERIC(5, 2) NOT NULL DEFAULT 80.00 CHECK (alert_threshold_percent > 0 AND alert_threshold_percent <= 100),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  CONSTRAINT fk_budget_policies_project_org
    FOREIGN KEY (project_id, organization_id)
    REFERENCES projects(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_budget_policies_vkey_org
    FOREIGN KEY (virtual_key_id, organization_id)
    REFERENCES virtual_keys(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE budget_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  budget_policy_id UUID NOT NULL,
  usage_event_id UUID,
  request_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reserved_amount NUMERIC(18, 8) NOT NULL CHECK (reserved_amount >= 0),
  settled_amount NUMERIC(18, 8) CHECK (settled_amount IS NULL OR settled_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released', 'uncertain', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  CONSTRAINT fk_budget_reservations_policy_org
    FOREIGN KEY (budget_policy_id, organization_id)
    REFERENCES budget_policies(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_budget_reservations_usage_org
    FOREIGN KEY (usage_event_id, organization_id)
    REFERENCES usage_events(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id)
);

CREATE INDEX idx_virtual_keys_org_project ON virtual_keys(organization_id, project_id);
CREATE INDEX idx_usage_events_org_project_created ON usage_events(organization_id, project_id, created_at);
CREATE INDEX idx_cost_records_org_category_period ON cost_records(organization_id, cost_category, period_start);
CREATE INDEX idx_budget_policies_org_scope ON budget_policies(organization_id, scope_type, is_active);
CREATE INDEX idx_audit_events_org_created ON audit_events(organization_id, created_at);

-- Down Migration
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS budget_reservations;
DROP TABLE IF EXISTS budget_policies;
DROP TABLE IF EXISTS reconciliation_matches;
DROP TABLE IF EXISTS cost_records;
DROP TABLE IF EXISTS model_prices;
DROP TABLE IF EXISTS usage_events;
DROP TABLE IF EXISTS virtual_keys;
