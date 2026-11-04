-- Up Migration: 010_client_origin

ALTER TABLE usage_events
  ADD COLUMN client_origin TEXT
    CHECK (client_origin IS NULL OR client_origin ~ '^[a-z0-9][a-z0-9._-]{0,39}$');

-- Down Migration
ALTER TABLE usage_events
  DROP COLUMN IF EXISTS client_origin;
