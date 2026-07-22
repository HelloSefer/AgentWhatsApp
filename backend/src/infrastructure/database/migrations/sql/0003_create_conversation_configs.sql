CREATE TABLE seller_conversation_configs (
  seller_id VARCHAR(128) PRIMARY KEY,
  schema_version SMALLINT NOT NULL,
  config_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seller_conversation_configs_seller_fk FOREIGN KEY (seller_id) REFERENCES sellers(seller_id),
  CONSTRAINT seller_conversation_configs_schema_version_valid CHECK (schema_version = 1),
  CONSTRAINT seller_conversation_configs_json_object CHECK (jsonb_typeof(config_json) = 'object')
);

CREATE TABLE product_conversation_config_overrides (
  seller_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  schema_version SMALLINT NOT NULL,
  config_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (seller_id, product_id),
  CONSTRAINT product_conversation_config_overrides_product_fk
    FOREIGN KEY (seller_id, product_id)
    REFERENCES products(seller_id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT product_conversation_config_overrides_schema_version_valid CHECK (schema_version = 1),
  CONSTRAINT product_conversation_config_overrides_json_object CHECK (jsonb_typeof(config_json) = 'object')
);
