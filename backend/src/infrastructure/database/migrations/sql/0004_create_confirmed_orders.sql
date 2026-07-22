CREATE TABLE orders (
  seller_id VARCHAR(128) NOT NULL,
  order_id VARCHAR(128) NOT NULL,
  customer_phone VARCHAR(32) NOT NULL,
  order_status VARCHAR(32) NOT NULL,
  currency_code VARCHAR(3) NOT NULL,
  subtotal_amount_minor BIGINT NOT NULL,
  delivery_amount_minor BIGINT NOT NULL,
  total_amount_minor BIGINT NOT NULL,
  delivery_details_json JSONB NOT NULL,
  confirmation_idempotency_key VARCHAR(160) NOT NULL,
  confirmation_payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (seller_id, order_id),
  CONSTRAINT orders_seller_fk FOREIGN KEY (seller_id) REFERENCES sellers(seller_id),
  CONSTRAINT orders_order_id_not_blank CHECK (BTRIM(order_id) <> '' AND order_id = BTRIM(order_id)),
  CONSTRAINT orders_customer_phone_not_blank CHECK (BTRIM(customer_phone) <> '' AND customer_phone = BTRIM(customer_phone)),
  CONSTRAINT orders_idempotency_key_not_blank CHECK (BTRIM(confirmation_idempotency_key) <> '' AND confirmation_idempotency_key = BTRIM(confirmation_idempotency_key)),
  CONSTRAINT orders_status_confirmed CHECK (order_status = 'CONFIRMED'),
  CONSTRAINT orders_currency_valid CHECK (currency_code = BTRIM(currency_code) AND currency_code = UPPER(currency_code) AND currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT orders_money_non_negative CHECK (subtotal_amount_minor >= 0 AND delivery_amount_minor >= 0 AND total_amount_minor >= 0),
  CONSTRAINT orders_total_matches_parts CHECK (total_amount_minor = subtotal_amount_minor + delivery_amount_minor),
  CONSTRAINT orders_delivery_details_object CHECK (jsonb_typeof(delivery_details_json) = 'object'),
  CONSTRAINT orders_payload_hash_valid CHECK (confirmation_payload_hash ~ '^[0-9A-Fa-f]{64}$'),
  CONSTRAINT orders_idempotency_unique UNIQUE (seller_id, confirmation_idempotency_key)
);

CREATE INDEX orders_seller_confirmed_order_idx ON orders (seller_id, confirmed_at DESC, order_id DESC);
CREATE INDEX orders_seller_customer_confirmed_order_idx ON orders (seller_id, customer_phone, confirmed_at DESC, order_id DESC);

CREATE TABLE order_items (
  seller_id VARCHAR(128) NOT NULL,
  order_id VARCHAR(128) NOT NULL,
  item_position INTEGER NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  selected_options_json JSONB NOT NULL,
  unit_price_amount_minor BIGINT NOT NULL,
  line_total_amount_minor BIGINT NOT NULL,
  PRIMARY KEY (seller_id, order_id, item_position),
  CONSTRAINT order_items_order_fk FOREIGN KEY (seller_id, order_id) REFERENCES orders(seller_id, order_id) ON DELETE CASCADE,
  CONSTRAINT order_items_position_valid CHECK (item_position >= 0),
  CONSTRAINT order_items_quantity_valid CHECK (quantity > 0),
  CONSTRAINT order_items_product_id_valid CHECK (BTRIM(product_id) <> '' AND product_id = BTRIM(product_id)),
  CONSTRAINT order_items_product_name_valid CHECK (BTRIM(product_name_snapshot) <> '' AND product_name_snapshot = BTRIM(product_name_snapshot)),
  CONSTRAINT order_items_options_array CHECK (jsonb_typeof(selected_options_json) = 'array'),
  CONSTRAINT order_items_money_non_negative CHECK (unit_price_amount_minor >= 0 AND line_total_amount_minor >= 0)
);

CREATE TABLE confirmed_order_snapshots (
  seller_id VARCHAR(128) NOT NULL,
  order_id VARCHAR(128) NOT NULL,
  schema_version SMALLINT NOT NULL,
  snapshot_json JSONB NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (seller_id, order_id),
  CONSTRAINT confirmed_order_snapshots_order_fk FOREIGN KEY (seller_id, order_id) REFERENCES orders(seller_id, order_id) ON DELETE CASCADE,
  CONSTRAINT confirmed_order_snapshots_schema_version_valid CHECK (schema_version = 1),
  CONSTRAINT confirmed_order_snapshots_json_object CHECK (jsonb_typeof(snapshot_json) = 'object'),
  CONSTRAINT confirmed_order_snapshots_hash_valid CHECK (snapshot_hash ~ '^[0-9A-Fa-f]{64}$')
);
