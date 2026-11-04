-- Up Migration: 005_epic_06_finance_and_budgets

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE model_prices
  ADD CONSTRAINT chk_ollama_price_is_simulated
  CHECK (
    lower(provider) <> 'ollama'
    OR (
      price_type IN ('internal_estimate', 'simulation')
      AND price_source = 'internal_simulation'
    )
  ),
  ADD CONSTRAINT ex_model_prices_no_overlapping_windows
  EXCLUDE USING gist (
    (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (lower(provider)) WITH =,
    model WITH =,
    price_type WITH =,
    (tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)')) WITH &&
  );

ALTER TABLE budget_policies
  ADD CONSTRAINT chk_budget_policy_scope_target
  CHECK (
    (scope_type = 'organization' AND project_id IS NULL AND virtual_key_id IS NULL)
    OR (scope_type = 'project' AND project_id IS NOT NULL AND virtual_key_id IS NULL)
    OR (scope_type = 'virtual_key' AND project_id IS NULL AND virtual_key_id IS NOT NULL)
  ),
  ADD CONSTRAINT chk_budget_policy_period
  CHECK (period_end > period_start);

CREATE UNIQUE INDEX uq_cost_records_gateway_usage
  ON cost_records (organization_id, usage_event_id)
  WHERE cost_category = 'gateway_estimated' AND usage_event_id IS NOT NULL;
CREATE UNIQUE INDEX uq_cost_records_license_assignment
  ON cost_records (organization_id, license_assignment_id)
  WHERE cost_category = 'license_contracted' AND license_assignment_id IS NOT NULL;

CREATE UNIQUE INDEX uq_reconciliation_estimated
  ON reconciliation_matches (organization_id, estimated_cost_record_id)
  WHERE estimated_cost_record_id IS NOT NULL;
CREATE UNIQUE INDEX uq_reconciliation_reported
  ON reconciliation_matches (organization_id, reported_cost_record_id)
  WHERE reported_cost_record_id IS NOT NULL;
CREATE UNIQUE INDEX uq_budget_reservation_request
  ON budget_reservations (organization_id, budget_policy_id, request_id);
CREATE INDEX idx_budget_reservations_policy_status
  ON budget_reservations (budget_policy_id, status, expires_at);

INSERT INTO model_prices (
  organization_id, provider, model, currency,
  input_price_per_million, output_price_per_million,
  price_source, price_type, effective_from
)
SELECT NULL, 'ollama', 'llama3.2', 'USD', 0.10000000, 0.20000000,
       'internal_simulation', 'simulation', '2020-01-01T00:00:00Z'
WHERE NOT EXISTS (
  SELECT 1 FROM model_prices
  WHERE organization_id IS NULL
    AND provider = 'ollama'
    AND model = 'llama3.2'
    AND price_type = 'simulation'
    AND effective_to IS NULL
);

-- Down Migration
DROP INDEX IF EXISTS idx_budget_reservations_policy_status;
DROP INDEX IF EXISTS uq_budget_reservation_request;
DROP INDEX IF EXISTS uq_reconciliation_reported;
DROP INDEX IF EXISTS uq_reconciliation_estimated;
DROP INDEX IF EXISTS uq_cost_records_gateway_usage;
DROP INDEX IF EXISTS uq_cost_records_license_assignment;
ALTER TABLE budget_policies
  DROP CONSTRAINT IF EXISTS chk_budget_policy_period,
  DROP CONSTRAINT IF EXISTS chk_budget_policy_scope_target;
ALTER TABLE model_prices
  DROP CONSTRAINT IF EXISTS ex_model_prices_no_overlapping_windows,
  DROP CONSTRAINT IF EXISTS chk_ollama_price_is_simulated;
