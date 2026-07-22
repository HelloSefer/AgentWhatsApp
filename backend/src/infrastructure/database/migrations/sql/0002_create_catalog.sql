CREATE TABLE products (
  seller_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  price_amount_minor BIGINT NOT NULL,
  currency_code VARCHAR(3) NOT NULL,
  availability_status VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (seller_id, product_id),
  CONSTRAINT products_seller_id_fk FOREIGN KEY (seller_id) REFERENCES sellers(seller_id),
  CONSTRAINT products_product_id_not_blank CHECK (BTRIM(product_id) <> ''),
  CONSTRAINT products_product_id_trimmed CHECK (product_id = BTRIM(product_id)),
  CONSTRAINT products_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT products_name_trimmed CHECK (name = BTRIM(name)),
  CONSTRAINT products_price_amount_minor_non_negative CHECK (price_amount_minor >= 0),
  CONSTRAINT products_currency_code_trimmed CHECK (currency_code = BTRIM(currency_code)),
  CONSTRAINT products_currency_code_uppercase CHECK (currency_code = UPPER(currency_code)),
  CONSTRAINT products_availability_status_valid CHECK (availability_status IN ('available', 'unavailable'))
);

CREATE INDEX products_seller_availability_product_id_idx
  ON products (seller_id, availability_status, product_id);

CREATE TABLE product_options (
  seller_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  option_id VARCHAR(128) NOT NULL,
  label VARCHAR(255) NOT NULL,
  is_required BOOLEAN NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (seller_id, product_id, option_id),
  CONSTRAINT product_options_product_fk
    FOREIGN KEY (seller_id, product_id)
    REFERENCES products(seller_id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT product_options_option_id_not_blank CHECK (BTRIM(option_id) <> ''),
  CONSTRAINT product_options_option_id_trimmed CHECK (option_id = BTRIM(option_id)),
  CONSTRAINT product_options_label_not_blank CHECK (BTRIM(label) <> ''),
  CONSTRAINT product_options_label_trimmed CHECK (label = BTRIM(label)),
  CONSTRAINT product_options_position_non_negative CHECK (position >= 0),
  CONSTRAINT product_options_position_unique UNIQUE (seller_id, product_id, position)
);

CREATE TABLE product_option_values (
  seller_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  option_id VARCHAR(128) NOT NULL,
  value_id VARCHAR(128) NOT NULL,
  label VARCHAR(255) NOT NULL,
  position INTEGER NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (seller_id, product_id, option_id, value_id),
  CONSTRAINT product_option_values_option_fk
    FOREIGN KEY (seller_id, product_id, option_id)
    REFERENCES product_options(seller_id, product_id, option_id)
    ON DELETE CASCADE,
  CONSTRAINT product_option_values_value_id_not_blank CHECK (BTRIM(value_id) <> ''),
  CONSTRAINT product_option_values_value_id_trimmed CHECK (value_id = BTRIM(value_id)),
  CONSTRAINT product_option_values_label_not_blank CHECK (BTRIM(label) <> ''),
  CONSTRAINT product_option_values_label_trimmed CHECK (label = BTRIM(label)),
  CONSTRAINT product_option_values_position_non_negative CHECK (position >= 0),
  CONSTRAINT product_option_values_position_unique UNIQUE (seller_id, product_id, option_id, position)
);
