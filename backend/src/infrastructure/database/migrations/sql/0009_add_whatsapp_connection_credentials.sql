ALTER TABLE whatsapp_connections
  ADD COLUMN encrypted_access_token TEXT,
  ADD COLUMN token_key_version VARCHAR(64),
  ADD COLUMN token_fingerprint VARCHAR(128),
  ADD COLUMN token_expires_at TIMESTAMPTZ,
  ADD CONSTRAINT whatsapp_connections_token_metadata_all_or_none CHECK (
    (
      encrypted_access_token IS NULL AND
      token_key_version IS NULL AND
      token_fingerprint IS NULL
    ) OR (
      encrypted_access_token IS NOT NULL AND
      token_key_version IS NOT NULL AND
      token_fingerprint IS NOT NULL
    )
  ),
  ADD CONSTRAINT whatsapp_connections_encrypted_access_token_not_blank CHECK (
    encrypted_access_token IS NULL OR BTRIM(encrypted_access_token) <> ''
  ),
  ADD CONSTRAINT whatsapp_connections_token_key_version_not_blank CHECK (
    token_key_version IS NULL OR (BTRIM(token_key_version) <> '' AND token_key_version = BTRIM(token_key_version))
  ),
  ADD CONSTRAINT whatsapp_connections_token_fingerprint_not_blank CHECK (
    token_fingerprint IS NULL OR (BTRIM(token_fingerprint) <> '' AND token_fingerprint = BTRIM(token_fingerprint))
  );

CREATE INDEX whatsapp_connections_token_fingerprint_idx
  ON whatsapp_connections (token_fingerprint)
  WHERE token_fingerprint IS NOT NULL;
