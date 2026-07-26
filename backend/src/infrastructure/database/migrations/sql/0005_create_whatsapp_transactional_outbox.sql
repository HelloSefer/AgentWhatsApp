CREATE TABLE IF NOT EXISTS whatsapp_transactional_outbox (
  outbox_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(seller_id) ON DELETE RESTRICT,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  outbound_role TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json JSONB NOT NULL,
  outbound_job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  publication_attempts INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_failure_code TEXT,
  last_failure_message TEXT,
  CONSTRAINT whatsapp_transactional_outbox_status_check
    CHECK (status IN ('pending', 'publishing', 'published')),
  CONSTRAINT whatsapp_transactional_outbox_schema_version_check
    CHECK (schema_version > 0),
  CONSTRAINT whatsapp_transactional_outbox_failure_code_length_check
    CHECK (last_failure_code IS NULL OR length(last_failure_code) <= 80),
  CONSTRAINT whatsapp_transactional_outbox_failure_message_length_check
    CHECK (last_failure_message IS NULL OR length(last_failure_message) <= 500),
  CONSTRAINT whatsapp_transactional_outbox_logical_unique
    UNIQUE (seller_id, aggregate_type, aggregate_id, outbound_role)
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_transactional_outbox_job_id_unique
  ON whatsapp_transactional_outbox (outbound_job_id);

CREATE INDEX IF NOT EXISTS whatsapp_transactional_outbox_pending_publication_idx
  ON whatsapp_transactional_outbox (created_at, outbox_id)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS whatsapp_transactional_outbox_claim_recovery_idx
  ON whatsapp_transactional_outbox (claim_expires_at, created_at)
  WHERE published_at IS NULL;
