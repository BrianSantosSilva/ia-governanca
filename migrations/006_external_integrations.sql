-- Up Migration: 006_external_integrations

ALTER TABLE license_assignments
  ALTER COLUMN contract_id DROP NOT NULL,
  ALTER COLUMN currency DROP NOT NULL,
  ALTER COLUMN seat_cost DROP NOT NULL;

-- Down Migration
-- The nullable fields preserve externally sourced seats whose financial terms
-- are not supplied by the provider. Keep them nullable during rollback rather
-- than inventing values or making rollback fail on valid imported data.
