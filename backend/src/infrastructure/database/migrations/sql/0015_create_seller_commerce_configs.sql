CREATE TABLE seller_commerce_configs (
  seller_id VARCHAR(128) PRIMARY KEY REFERENCES sellers(seller_id) ON DELETE CASCADE,
  schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  config_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
