DROP INDEX IF EXISTS whatsapp_connections_phone_number_id_unique_idx;

CREATE UNIQUE INDEX whatsapp_connections_current_phone_number_id_unique_idx
  ON whatsapp_connections (phone_number_id)
  WHERE phone_number_id IS NOT NULL
    AND status IN ('PENDING', 'VERIFYING', 'ACTIVE', 'REPLACEMENT_PENDING');
