ALTER TABLE whatsapp_connections
  ADD COLUMN replaced_connection_id VARCHAR(64),
  ADD CONSTRAINT whatsapp_connections_replaced_connection_fk
    FOREIGN KEY (replaced_connection_id)
    REFERENCES whatsapp_connections(connection_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT whatsapp_connections_replaced_connection_not_self CHECK (
    replaced_connection_id IS NULL OR replaced_connection_id <> connection_id
  );

CREATE INDEX whatsapp_connections_replaced_connection_id_idx
  ON whatsapp_connections (replaced_connection_id)
  WHERE replaced_connection_id IS NOT NULL;
