-- Up Migration: 008_virtual_key_scopes

ALTER TABLE virtual_keys
  ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN team_id UUID,
  ADD CONSTRAINT fk_virtual_keys_team_org
    FOREIGN KEY (team_id, organization_id)
    REFERENCES teams(id, organization_id)
    ON DELETE RESTRICT,
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE usage_events
  DROP CONSTRAINT fk_usage_events_vkey_project_org,
  ADD CONSTRAINT fk_usage_events_vkey_org
    FOREIGN KEY (virtual_key_id, organization_id)
    REFERENCES virtual_keys(id, organization_id)
    ON DELETE RESTRICT,
  ALTER COLUMN project_id DROP NOT NULL;

UPDATE virtual_keys
SET scope_type = 'user',
    project_id = NULL
WHERE owner_user_id IS NOT NULL;

ALTER TABLE virtual_keys
  ADD CONSTRAINT chk_virtual_keys_scope_target
  CHECK (
    (scope_type = 'project' AND project_id IS NOT NULL AND team_id IS NULL AND owner_user_id IS NULL)
    OR (scope_type = 'team' AND project_id IS NULL AND team_id IS NOT NULL AND owner_user_id IS NULL)
    OR (scope_type = 'user' AND project_id IS NULL AND team_id IS NULL AND owner_user_id IS NOT NULL)
  ),
  ADD CONSTRAINT chk_virtual_keys_scope_type
    CHECK (scope_type IN ('project', 'team', 'user'));

ALTER TABLE team_memberships
  ADD CONSTRAINT uq_team_memberships_org_user UNIQUE (organization_id, user_id);

CREATE INDEX idx_virtual_keys_org_team ON virtual_keys(organization_id, team_id);
CREATE INDEX idx_virtual_keys_org_scope ON virtual_keys(organization_id, scope_type);

-- Down Migration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM virtual_keys WHERE scope_type <> 'project')
     OR EXISTS (SELECT 1 FROM usage_events WHERE project_id IS NULL) THEN
    RAISE EXCEPTION 'Revoke team/user keys and resolve projectless usage before rolling back migration 008';
  END IF;
END
$$;
DROP INDEX IF EXISTS idx_virtual_keys_org_scope;
DROP INDEX IF EXISTS idx_virtual_keys_org_team;
ALTER TABLE team_memberships DROP CONSTRAINT IF EXISTS uq_team_memberships_org_user;
ALTER TABLE virtual_keys
  DROP CONSTRAINT IF EXISTS chk_virtual_keys_scope_type,
  DROP CONSTRAINT IF EXISTS chk_virtual_keys_scope_target,
  DROP CONSTRAINT IF EXISTS fk_virtual_keys_team_org,
  DROP COLUMN IF EXISTS team_id,
  DROP COLUMN IF EXISTS scope_type,
  ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE usage_events
  DROP CONSTRAINT IF EXISTS fk_usage_events_vkey_org,
  ALTER COLUMN project_id SET NOT NULL,
  ADD CONSTRAINT fk_usage_events_vkey_project_org
    FOREIGN KEY (virtual_key_id, project_id, organization_id)
    REFERENCES virtual_keys(id, project_id, organization_id)
    ON DELETE RESTRICT;
