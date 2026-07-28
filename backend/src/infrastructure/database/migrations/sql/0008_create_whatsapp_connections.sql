CREATE TABLE whatsapp_connections (
  connection_id VARCHAR(64) PRIMARY KEY,
  seller_id VARCHAR(128) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  meta_business_id VARCHAR(128),
  waba_id VARCHAR(128),
  phone_number_id VARCHAR(128),
  display_phone_number VARCHAR(64),
  verified_name TEXT,
  connected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_connections_seller_fk
    FOREIGN KEY (seller_id)
    REFERENCES sellers(seller_id)
    ON DELETE CASCADE,
  CONSTRAINT whatsapp_connections_connection_id_not_blank CHECK (BTRIM(connection_id) <> ''),
  CONSTRAINT whatsapp_connections_connection_id_trimmed CHECK (connection_id = BTRIM(connection_id)),
  CONSTRAINT whatsapp_connections_seller_id_not_blank CHECK (BTRIM(seller_id) <> ''),
  CONSTRAINT whatsapp_connections_seller_id_trimmed CHECK (seller_id = BTRIM(seller_id)),
  CONSTRAINT whatsapp_connections_seller_id_not_default CHECK (
    LOWER(REGEXP_REPLACE(BTRIM(seller_id), '[[:space:]_-]+', '-', 'g')) <> 'default-seller'
  ),
  CONSTRAINT whatsapp_connections_provider_meta_only CHECK (provider = 'META_WHATSAPP_CLOUD_API'),
  CONSTRAINT whatsapp_connections_status_supported CHECK (
    status IN (
      'PENDING',
      'VERIFYING',
      'ACTIVE',
      'REPLACEMENT_PENDING',
      'ERROR',
      'DISCONNECTED',
      'REVOKED'
    )
  ),
  CONSTRAINT whatsapp_connections_meta_business_id_safe CHECK (
    meta_business_id IS NULL OR (BTRIM(meta_business_id) <> '' AND meta_business_id = BTRIM(meta_business_id))
  ),
  CONSTRAINT whatsapp_connections_waba_id_safe CHECK (
    waba_id IS NULL OR (BTRIM(waba_id) <> '' AND waba_id = BTRIM(waba_id))
  ),
  CONSTRAINT whatsapp_connections_phone_number_id_safe CHECK (
    phone_number_id IS NULL OR (BTRIM(phone_number_id) <> '' AND phone_number_id = BTRIM(phone_number_id))
  ),
  CONSTRAINT whatsapp_connections_display_phone_number_safe CHECK (
    display_phone_number IS NULL OR (BTRIM(display_phone_number) <> '' AND display_phone_number = BTRIM(display_phone_number))
  ),
  CONSTRAINT whatsapp_connections_verified_name_safe CHECK (
    verified_name IS NULL OR BTRIM(verified_name) <> ''
  )
);

CREATE INDEX whatsapp_connections_seller_created_at_idx
  ON whatsapp_connections (seller_id, created_at DESC);

CREATE UNIQUE INDEX whatsapp_connections_one_active_per_seller_idx
  ON whatsapp_connections (seller_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX whatsapp_connections_phone_number_id_unique_idx
  ON whatsapp_connections (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

CREATE INDEX whatsapp_connections_active_phone_number_id_idx
  ON whatsapp_connections (phone_number_id)
  WHERE status = 'ACTIVE';
