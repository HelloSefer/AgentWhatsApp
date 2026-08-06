CREATE TABLE product_images (
  seller_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  position INTEGER NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  PRIMARY KEY (seller_id, product_id, position),
  CONSTRAINT product_images_product_fk
    FOREIGN KEY (seller_id, product_id)
    REFERENCES products(seller_id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT product_images_position_non_negative CHECK (position >= 0),
  CONSTRAINT product_images_object_key_valid CHECK (
    BTRIM(object_key) = object_key AND object_key <> '' AND
    object_key !~ '(^/|\\|://|(^|/)\.\.?(/|$))' AND
    object_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
  ),
  CONSTRAINT product_images_mime_type_valid CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp'))
);

CREATE TABLE product_aliases (
  seller_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  alias VARCHAR(255) NOT NULL,
  normalized_alias VARCHAR(255) NOT NULL,
  PRIMARY KEY (seller_id, normalized_alias),
  CONSTRAINT product_aliases_product_fk
    FOREIGN KEY (seller_id, product_id)
    REFERENCES products(seller_id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT product_aliases_alias_valid CHECK (BTRIM(alias) = alias AND alias <> ''),
  CONSTRAINT product_aliases_normalized_alias_valid CHECK (BTRIM(normalized_alias) = normalized_alias AND normalized_alias <> '')
);

CREATE TABLE product_offers (
  seller_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  offer_id VARCHAR(128) NOT NULL,
  label VARCHAR(160) NOT NULL,
  required_item_count INTEGER NOT NULL,
  total_price_amount_minor BIGINT NOT NULL,
  is_active BOOLEAN NOT NULL,
  allow_mixed_options BOOLEAN NOT NULL,
  priority INTEGER,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  PRIMARY KEY (seller_id, product_id, offer_id),
  CONSTRAINT product_offers_product_fk
    FOREIGN KEY (seller_id, product_id)
    REFERENCES products(seller_id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT product_offers_offer_id_valid CHECK (BTRIM(offer_id) = offer_id AND offer_id <> ''),
  CONSTRAINT product_offers_label_valid CHECK (BTRIM(label) = label AND label <> ''),
  CONSTRAINT product_offers_required_item_count_positive CHECK (required_item_count > 0),
  CONSTRAINT product_offers_total_price_positive CHECK (total_price_amount_minor > 0),
  CONSTRAINT product_offers_priority_valid CHECK (priority IS NULL OR ABS(priority) <= 100000),
  CONSTRAINT product_offers_window_valid CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);
