CREATE TABLE sellers (
  seller_id VARCHAR(128) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sellers_seller_id_not_blank CHECK (BTRIM(seller_id) <> ''),
  CONSTRAINT sellers_seller_id_trimmed CHECK (seller_id = BTRIM(seller_id)),
  CONSTRAINT sellers_seller_id_not_default CHECK (
    LOWER(REGEXP_REPLACE(BTRIM(seller_id), '[[:space:]_-]+', '-', 'g')) <> 'default-seller'
  )
);
