ALTER TABLE whatsapp_connections
  ADD COLUMN encrypted_registration_pin TEXT,
  ADD COLUMN registration_pin_key_version VARCHAR(64),
  ADD COLUMN registration_pin_fingerprint VARCHAR(128),
  ADD COLUMN phone_registration_completed_at TIMESTAMPTZ,
  ADD COLUMN waba_subscription_completed_at TIMESTAMPTZ,
  ADD COLUMN finalization_last_error_code VARCHAR(64),
  ADD COLUMN finalization_last_error_at TIMESTAMPTZ,
  ADD CONSTRAINT whatsapp_connections_registration_pin_metadata_all_or_none CHECK (
    (
      encrypted_registration_pin IS NULL AND
      registration_pin_key_version IS NULL AND
      registration_pin_fingerprint IS NULL
    ) OR (
      encrypted_registration_pin IS NOT NULL AND
      registration_pin_key_version IS NOT NULL AND
      registration_pin_fingerprint IS NOT NULL
    )
  ),
  ADD CONSTRAINT whatsapp_connections_encrypted_registration_pin_not_blank CHECK (
    encrypted_registration_pin IS NULL OR BTRIM(encrypted_registration_pin) <> ''
  ),
  ADD CONSTRAINT whatsapp_connections_registration_pin_key_version_not_blank CHECK (
    registration_pin_key_version IS NULL OR (
      BTRIM(registration_pin_key_version) <> '' AND
      registration_pin_key_version = BTRIM(registration_pin_key_version)
    )
  ),
  ADD CONSTRAINT whatsapp_connections_registration_pin_fingerprint_not_blank CHECK (
    registration_pin_fingerprint IS NULL OR (
      BTRIM(registration_pin_fingerprint) <> '' AND
      registration_pin_fingerprint = BTRIM(registration_pin_fingerprint)
    )
  ),
  ADD CONSTRAINT whatsapp_connections_finalization_error_all_or_none CHECK (
    (
      finalization_last_error_code IS NULL AND
      finalization_last_error_at IS NULL
    ) OR (
      finalization_last_error_code IS NOT NULL AND
      finalization_last_error_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT whatsapp_connections_finalization_error_code_safe CHECK (
    finalization_last_error_code IS NULL OR (
      BTRIM(finalization_last_error_code) <> '' AND
      finalization_last_error_code = BTRIM(finalization_last_error_code) AND
      finalization_last_error_code ~ '^[a-z0-9_]+$'
    )
  );

CREATE INDEX whatsapp_connections_registration_pin_fingerprint_idx
  ON whatsapp_connections (registration_pin_fingerprint)
  WHERE registration_pin_fingerprint IS NOT NULL;
