-- Up Migration: 009_chat_guardrails

ALTER TABLE usage_events
  ADD COLUMN source TEXT NOT NULL DEFAULT 'gateway'
    CHECK (source IN ('gateway', 'dashboard_test')),
  ADD COLUMN test_actor_user_id UUID,
  ADD CONSTRAINT fk_usage_events_test_actor_membership
    FOREIGN KEY (organization_id, test_actor_user_id)
    REFERENCES memberships(organization_id, user_id)
    ON DELETE RESTRICT;

CREATE TABLE guardrail_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('deterministic', 'intelligent')),
  mode TEXT NOT NULL CHECK (mode IN ('runtime', 'async')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('organization', 'project', 'team', 'user', 'virtual_key')),
  scope_id UUID,
  terms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  evaluator_provider TEXT,
  evaluator_model TEXT,
  evaluator_prompt TEXT,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  CONSTRAINT fk_guardrail_rules_creator_membership
    FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES memberships(organization_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_guardrail_rule_scope
    CHECK (
      (scope_type = 'organization' AND scope_id IS NULL)
      OR (scope_type <> 'organization' AND scope_id IS NOT NULL)
    ),
  CONSTRAINT chk_guardrail_rule_config
    CHECK (
      (rule_type = 'deterministic' AND cardinality(terms) > 0
        AND evaluator_provider IS NULL AND evaluator_model IS NULL AND evaluator_prompt IS NULL)
      OR (rule_type = 'intelligent' AND cardinality(terms) = 0
        AND evaluator_provider IS NOT NULL AND evaluator_provider IN ('ollama', 'gemini')
        AND evaluator_model IS NOT NULL AND evaluator_prompt IS NOT NULL)
    )
);

CREATE TABLE guardrail_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  guardrail_rule_id UUID NOT NULL,
  virtual_key_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  usage_event_id UUID,
  mode TEXT NOT NULL CHECK (mode IN ('runtime', 'async')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'allowed', 'violation', 'inconclusive', 'failed')),
  evaluator_provider TEXT,
  evaluator_model TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_amount NUMERIC(18, 8) CHECK (cost_amount IS NULL OR cost_amount >= 0),
  cost_currency CHAR(3) CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$'),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  error_code TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, guardrail_rule_id, request_id),
  CONSTRAINT fk_guardrail_evaluations_rule_org
    FOREIGN KEY (guardrail_rule_id, organization_id)
    REFERENCES guardrail_rules(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guardrail_evaluations_key_org
    FOREIGN KEY (virtual_key_id, organization_id)
    REFERENCES virtual_keys(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guardrail_evaluations_event_org
    FOREIGN KEY (usage_event_id, organization_id)
    REFERENCES usage_events(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE guardrail_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  guardrail_rule_id UUID NOT NULL,
  guardrail_evaluation_id UUID,
  virtual_key_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  actor_user_id UUID,
  usage_event_id UUID,
  mode TEXT NOT NULL CHECK (mode IN ('runtime', 'async')),
  outcome TEXT NOT NULL CHECK (outcome IN ('violation', 'inconclusive', 'failed')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, guardrail_rule_id, request_id),
  CONSTRAINT fk_guardrail_alerts_rule_org
    FOREIGN KEY (guardrail_rule_id, organization_id)
    REFERENCES guardrail_rules(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guardrail_alerts_evaluation_org
    FOREIGN KEY (guardrail_evaluation_id, organization_id)
    REFERENCES guardrail_evaluations(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guardrail_alerts_key_org
    FOREIGN KEY (virtual_key_id, organization_id)
    REFERENCES virtual_keys(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guardrail_alerts_actor_membership
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES memberships(organization_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guardrail_alerts_event_org
    FOREIGN KEY (usage_event_id, organization_id)
    REFERENCES usage_events(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE guardrail_test_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  virtual_key_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_guardrail_test_tickets_key_org
    FOREIGN KEY (virtual_key_id, organization_id)
    REFERENCES virtual_keys(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guardrail_test_tickets_actor_membership
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES memberships(organization_id, user_id)
    ON DELETE RESTRICT
);

ALTER TABLE cost_records
  ADD COLUMN source_guardrail_evaluation_id UUID,
  DROP CONSTRAINT cost_records_cost_category_check,
  ADD CONSTRAINT chk_cost_records_category_guardrails
    CHECK (cost_category IN (
      'gateway_estimated', 'guardrail_evaluation', 'provider_reported',
      'license_contracted', 'financial_adjustment', 'unreconciled'
    ));

CREATE UNIQUE INDEX uq_cost_records_guardrail_evaluation
  ON cost_records (organization_id, source_guardrail_evaluation_id)
  WHERE source_guardrail_evaluation_id IS NOT NULL;
CREATE INDEX idx_guardrail_rules_org_active ON guardrail_rules(organization_id, is_active, mode);
CREATE INDEX idx_guardrail_alerts_org_created ON guardrail_alerts(organization_id, created_at DESC);
CREATE INDEX idx_guardrail_alerts_expiry ON guardrail_alerts(expires_at);
CREATE INDEX idx_guardrail_evaluations_expiry ON guardrail_evaluations(expires_at);
CREATE INDEX idx_guardrail_test_tickets_expiry ON guardrail_test_tickets(expires_at);

-- Down Migration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cost_records WHERE cost_category = 'guardrail_evaluation') THEN
    RAISE EXCEPTION
      'Preserve or reclassify guardrail evaluation costs before rolling back migration 009';
  END IF;
END
$$;
DROP INDEX IF EXISTS idx_guardrail_test_tickets_expiry;
DROP INDEX IF EXISTS idx_guardrail_evaluations_expiry;
DROP INDEX IF EXISTS idx_guardrail_alerts_expiry;
DROP INDEX IF EXISTS idx_guardrail_alerts_org_created;
DROP INDEX IF EXISTS idx_guardrail_rules_org_active;
DROP INDEX IF EXISTS uq_cost_records_guardrail_evaluation;
ALTER TABLE cost_records DROP COLUMN IF EXISTS source_guardrail_evaluation_id;
ALTER TABLE cost_records
  DROP CONSTRAINT IF EXISTS chk_cost_records_category_guardrails,
  ADD CONSTRAINT cost_records_cost_category_check
    CHECK (cost_category IN (
      'gateway_estimated', 'provider_reported', 'license_contracted',
      'financial_adjustment', 'unreconciled'
    ));
DROP TABLE IF EXISTS guardrail_test_tickets;
DROP TABLE IF EXISTS guardrail_alerts;
DROP TABLE IF EXISTS guardrail_evaluations;
DROP TABLE IF EXISTS guardrail_rules;
ALTER TABLE usage_events
  DROP CONSTRAINT IF EXISTS fk_usage_events_test_actor_membership,
  DROP COLUMN IF EXISTS test_actor_user_id,
  DROP COLUMN IF EXISTS source;
