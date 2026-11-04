-- Up Migration: 007_epic_10_governance_privacy

ALTER TABLE virtual_keys
  ADD COLUMN owner_user_id UUID,
  ADD CONSTRAINT fk_virtual_keys_owner_membership_org
    FOREIGN KEY (organization_id, owner_user_id)
    REFERENCES memberships(organization_id, user_id)
    ON DELETE RESTRICT;

ALTER TABLE usage_events
  ADD COLUMN team_id UUID,
  ADD COLUMN user_id UUID,
  ADD CONSTRAINT fk_usage_events_team_org
    FOREIGN KEY (team_id, organization_id)
    REFERENCES teams(id, organization_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usage_events_user_membership_org
    FOREIGN KEY (organization_id, user_id)
    REFERENCES memberships(organization_id, user_id)
    ON DELETE RESTRICT;

ALTER TABLE cost_records
  ADD COLUMN team_id UUID,
  ADD COLUMN user_id UUID,
  ADD CONSTRAINT fk_cost_records_team_org
    FOREIGN KEY (team_id, organization_id)
    REFERENCES teams(id, organization_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cost_records_user_membership_org
    FOREIGN KEY (organization_id, user_id)
    REFERENCES memberships(organization_id, user_id)
    ON DELETE RESTRICT;

UPDATE usage_events ue
SET team_id = p.team_id,
    user_id = vk.owner_user_id
FROM projects p, virtual_keys vk
WHERE p.id = ue.project_id AND p.organization_id = ue.organization_id
  AND vk.id = ue.virtual_key_id AND vk.organization_id = ue.organization_id;

UPDATE cost_records cr
SET team_id = ue.team_id,
    user_id = ue.user_id
FROM usage_events ue
WHERE cr.usage_event_id = ue.id AND cr.organization_id = ue.organization_id;

UPDATE cost_records cr
SET team_id = p.team_id
FROM projects p
WHERE cr.team_id IS NULL
  AND cr.project_id = p.id
  AND cr.organization_id = p.organization_id;

ALTER TABLE budget_policies
  DROP CONSTRAINT budget_policies_scope_type_check,
  ADD CONSTRAINT budget_policies_scope_type_check
    CHECK (scope_type IN ('organization', 'project', 'virtual_key', 'team', 'user')),
  ADD COLUMN team_id UUID,
  ADD COLUMN user_id UUID,
  ADD CONSTRAINT fk_budget_policies_team_org
    FOREIGN KEY (team_id, organization_id)
    REFERENCES teams(id, organization_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT fk_budget_policies_user_membership_org
    FOREIGN KEY (organization_id, user_id)
    REFERENCES memberships(organization_id, user_id)
    ON DELETE RESTRICT;

ALTER TABLE budget_policies
  DROP CONSTRAINT chk_budget_policy_scope_target,
  ADD CONSTRAINT chk_budget_policy_scope_target
  CHECK (
    (scope_type = 'organization' AND project_id IS NULL AND virtual_key_id IS NULL AND team_id IS NULL AND user_id IS NULL)
    OR (scope_type = 'project' AND project_id IS NOT NULL AND virtual_key_id IS NULL AND team_id IS NULL AND user_id IS NULL)
    OR (scope_type = 'virtual_key' AND project_id IS NULL AND virtual_key_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL)
    OR (scope_type = 'team' AND project_id IS NULL AND virtual_key_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL)
    OR (scope_type = 'user' AND project_id IS NULL AND virtual_key_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL)
  );

ALTER TABLE organizations
  ADD COLUMN prompt_capture_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN prompt_capture_retention_days INTEGER NOT NULL DEFAULT 7
    CHECK (prompt_capture_retention_days BETWEEN 1 AND 365);

CREATE TABLE usage_event_content (
  usage_event_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  content_ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
  auth_tag BYTEA NOT NULL CHECK (octet_length(auth_tag) = 16),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usage_event_id, organization_id),
  CONSTRAINT fk_usage_event_content_event_org
    FOREIGN KEY (usage_event_id, organization_id)
    REFERENCES usage_events(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_usage_events_org_team_time ON usage_events(organization_id, team_id, created_at DESC);
CREATE INDEX idx_usage_events_org_user_time ON usage_events(organization_id, user_id, created_at DESC);
CREATE INDEX idx_cost_records_org_team_time ON cost_records(organization_id, team_id, period_start);
CREATE INDEX idx_cost_records_org_user_time ON cost_records(organization_id, user_id, period_start);
CREATE INDEX idx_usage_event_content_expiry ON usage_event_content(expires_at);

-- Down Migration
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM budget_policies WHERE scope_type IN ('team', 'user')
  ) THEN
    RAISE EXCEPTION
      'Resolve or remove team/user budget policies before rolling back migration 007';
  END IF;
END
$$;
DROP INDEX IF EXISTS idx_usage_event_content_expiry;
DROP INDEX IF EXISTS idx_cost_records_org_user_time;
DROP INDEX IF EXISTS idx_cost_records_org_team_time;
DROP INDEX IF EXISTS idx_usage_events_org_user_time;
DROP INDEX IF EXISTS idx_usage_events_org_team_time;
DROP TABLE IF EXISTS usage_event_content;
ALTER TABLE organizations
  DROP COLUMN IF EXISTS prompt_capture_retention_days,
  DROP COLUMN IF EXISTS prompt_capture_enabled;
ALTER TABLE budget_policies
  DROP CONSTRAINT IF EXISTS chk_budget_policy_scope_target,
  DROP CONSTRAINT IF EXISTS budget_policies_scope_type_check,
  ADD CONSTRAINT budget_policies_scope_type_check
    CHECK (scope_type IN ('organization', 'project', 'virtual_key')),
  ADD CONSTRAINT chk_budget_policy_scope_target
  CHECK (
    (scope_type = 'organization' AND project_id IS NULL AND virtual_key_id IS NULL)
    OR (scope_type = 'project' AND project_id IS NOT NULL AND virtual_key_id IS NULL)
    OR (scope_type = 'virtual_key' AND project_id IS NULL AND virtual_key_id IS NOT NULL)
  ),
  DROP CONSTRAINT IF EXISTS fk_budget_policies_user_membership_org,
  DROP CONSTRAINT IF EXISTS fk_budget_policies_team_org,
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS team_id;
ALTER TABLE cost_records
  DROP CONSTRAINT IF EXISTS fk_cost_records_user_membership_org,
  DROP CONSTRAINT IF EXISTS fk_cost_records_team_org,
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS team_id;
ALTER TABLE usage_events
  DROP CONSTRAINT IF EXISTS fk_usage_events_user_membership_org,
  DROP CONSTRAINT IF EXISTS fk_usage_events_team_org,
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS team_id;
ALTER TABLE virtual_keys
  DROP CONSTRAINT IF EXISTS fk_virtual_keys_owner_membership_org,
  DROP COLUMN IF EXISTS owner_user_id;
