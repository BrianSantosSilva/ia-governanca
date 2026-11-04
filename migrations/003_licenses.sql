-- Up Migration: 003_licenses

CREATE TABLE license_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  product_name TEXT NOT NULL,
  contracted_seats INTEGER NOT NULL CHECK (contracted_seats > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_contract_value NUMERIC(18, 6) NOT NULL CHECK (total_contract_value >= 0),
  cost_per_seat NUMERIC(18, 6) NOT NULL CHECK (cost_per_seat >= 0),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual', 'custom')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id)
);

CREATE TABLE license_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  contract_id UUID NOT NULL,
  user_id UUID,
  external_identity_id UUID,
  source_record_id UUID,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'revoked', 'pending_review')),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  seat_cost NUMERIC(18, 6) NOT NULL CHECK (seat_cost >= 0),
  assigned_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  CONSTRAINT chk_license_assignment_holder
    CHECK (user_id IS NOT NULL OR external_identity_id IS NOT NULL),
  CONSTRAINT fk_license_assignments_contract_org
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES license_contracts(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_license_assignments_user_org
    FOREIGN KEY (user_id, organization_id)
    REFERENCES memberships(user_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_license_assignments_ext_id_org
    FOREIGN KEY (external_identity_id, organization_id)
    REFERENCES external_identities(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_license_assignments_source_org
    FOREIGN KEY (source_record_id, organization_id)
    REFERENCES source_records(id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_license_contracts_org ON license_contracts(organization_id, provider);
CREATE INDEX idx_license_assignments_org_contract ON license_assignments(organization_id, contract_id, status);

-- Down Migration
DROP TABLE IF EXISTS license_assignments;
DROP TABLE IF EXISTS license_contracts;
