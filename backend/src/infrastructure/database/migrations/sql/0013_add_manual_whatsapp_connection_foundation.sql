ALTER TABLE whatsapp_connections
  ADD COLUMN connection_method VARCHAR(32) NOT NULL DEFAULT 'EMBEDDED_SIGNUP',
  ADD COLUMN meta_app_id VARCHAR(32),
  ADD COLUMN public_webhook_id VARCHAR(64),
  ADD COLUMN encrypted_meta_app_secret TEXT,
  ADD COLUMN meta_app_secret_key_version VARCHAR(64),
  ADD COLUMN encrypted_system_user_access_token TEXT,
  ADD COLUMN system_user_access_token_key_version VARCHAR(64),
  ADD COLUMN encrypted_webhook_verify_token TEXT,
  ADD COLUMN webhook_verify_token_key_version VARCHAR(64),
  ADD CONSTRAINT whatsapp_connections_connection_method_supported CHECK (
    connection_method IN ('EMBEDDED_SIGNUP', 'CUSTOMER_OWNED_META_APP')
  ),
  ADD CONSTRAINT whatsapp_connections_meta_app_id_safe CHECK (
    meta_app_id IS NULL OR (
      BTRIM(meta_app_id) <> '' AND
      meta_app_id = BTRIM(meta_app_id) AND
      meta_app_id ~ '^[0-9]+$'
    )
  ),
  ADD CONSTRAINT whatsapp_connections_public_webhook_id_safe CHECK (
    public_webhook_id IS NULL OR (BTRIM(public_webhook_id) <> '' AND public_webhook_id = BTRIM(public_webhook_id))
  ),
  ADD CONSTRAINT whatsapp_connections_manual_app_secret_not_blank CHECK (
    encrypted_meta_app_secret IS NULL OR BTRIM(encrypted_meta_app_secret) <> ''
  ),
  ADD CONSTRAINT whatsapp_connections_manual_app_secret_key_version_not_blank CHECK (
    meta_app_secret_key_version IS NULL OR (BTRIM(meta_app_secret_key_version) <> '' AND meta_app_secret_key_version = BTRIM(meta_app_secret_key_version))
  ),
  ADD CONSTRAINT whatsapp_connections_manual_system_token_not_blank CHECK (
    encrypted_system_user_access_token IS NULL OR BTRIM(encrypted_system_user_access_token) <> ''
  ),
  ADD CONSTRAINT whatsapp_connections_manual_system_token_key_version_not_blank CHECK (
    system_user_access_token_key_version IS NULL OR (BTRIM(system_user_access_token_key_version) <> '' AND system_user_access_token_key_version = BTRIM(system_user_access_token_key_version))
  ),
  ADD CONSTRAINT whatsapp_connections_manual_webhook_token_not_blank CHECK (
    encrypted_webhook_verify_token IS NULL OR BTRIM(encrypted_webhook_verify_token) <> ''
  ),
  ADD CONSTRAINT whatsapp_connections_manual_webhook_token_key_version_not_blank CHECK (
    webhook_verify_token_key_version IS NULL OR (BTRIM(webhook_verify_token_key_version) <> '' AND webhook_verify_token_key_version = BTRIM(webhook_verify_token_key_version))
  ),
  ADD CONSTRAINT whatsapp_connections_manual_setup_shape CHECK (
    (
      connection_method = 'EMBEDDED_SIGNUP' AND
      meta_app_id IS NULL AND
      public_webhook_id IS NULL AND
      encrypted_meta_app_secret IS NULL AND
      meta_app_secret_key_version IS NULL AND
      encrypted_system_user_access_token IS NULL AND
      system_user_access_token_key_version IS NULL AND
      encrypted_webhook_verify_token IS NULL AND
      webhook_verify_token_key_version IS NULL
    ) OR (
      connection_method = 'CUSTOMER_OWNED_META_APP' AND
      meta_app_id IS NOT NULL AND
      public_webhook_id IS NOT NULL AND
      (
        (
          encrypted_meta_app_secret IS NULL AND
          meta_app_secret_key_version IS NULL AND
          encrypted_system_user_access_token IS NULL AND
          system_user_access_token_key_version IS NULL AND
          encrypted_webhook_verify_token IS NULL AND
          webhook_verify_token_key_version IS NULL
        ) OR (
          encrypted_meta_app_secret IS NOT NULL AND
          meta_app_secret_key_version IS NOT NULL AND
          encrypted_system_user_access_token IS NOT NULL AND
          system_user_access_token_key_version IS NOT NULL AND
          encrypted_webhook_verify_token IS NOT NULL AND
          webhook_verify_token_key_version IS NOT NULL
        )
      )
    )
  );

CREATE UNIQUE INDEX whatsapp_connections_public_webhook_id_unique_idx
  ON whatsapp_connections (public_webhook_id)
  WHERE public_webhook_id IS NOT NULL;

CREATE UNIQUE INDEX whatsapp_connections_manual_pending_retry_idx
  ON whatsapp_connections (seller_id, meta_app_id)
  WHERE connection_method = 'CUSTOMER_OWNED_META_APP' AND status = 'PENDING';
