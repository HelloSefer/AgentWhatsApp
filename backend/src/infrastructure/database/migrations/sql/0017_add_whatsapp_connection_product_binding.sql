ALTER TABLE whatsapp_connections
  ADD COLUMN bound_product_id VARCHAR(128) NULL,
  ADD CONSTRAINT whatsapp_connections_bound_product_fk
    FOREIGN KEY (seller_id, bound_product_id)
    REFERENCES products(seller_id, product_id)
    ON DELETE SET NULL (bound_product_id);
