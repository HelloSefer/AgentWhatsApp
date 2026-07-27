CREATE TABLE seller_workspace_profiles (
  seller_id VARCHAR(128) PRIMARY KEY,
  display_name TEXT NOT NULL,
  slug VARCHAR(160) NOT NULL,
  intended_whatsapp_phone_e164 VARCHAR(16),
  logo_object_key TEXT,
  logo_mime_type VARCHAR(100),
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seller_workspace_profiles_seller_fk
    FOREIGN KEY (seller_id)
    REFERENCES sellers(seller_id)
    ON DELETE CASCADE,
  CONSTRAINT seller_workspace_profiles_seller_id_not_blank CHECK (BTRIM(seller_id) <> ''),
  CONSTRAINT seller_workspace_profiles_seller_id_trimmed CHECK (seller_id = BTRIM(seller_id)),
  CONSTRAINT seller_workspace_profiles_seller_id_not_default CHECK (
    LOWER(REGEXP_REPLACE(BTRIM(seller_id), '[[:space:]_-]+', '-', 'g')) <> 'default-seller'
  ),
  CONSTRAINT seller_workspace_profiles_display_name_not_blank CHECK (BTRIM(display_name) <> ''),
  CONSTRAINT seller_workspace_profiles_slug_not_blank CHECK (BTRIM(slug) <> ''),
  CONSTRAINT seller_workspace_profiles_slug_trimmed CHECK (slug = BTRIM(slug)),
  CONSTRAINT seller_workspace_profiles_slug_safe CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT seller_workspace_profiles_phone_e164 CHECK (
    intended_whatsapp_phone_e164 IS NULL OR intended_whatsapp_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'
  ),
  CONSTRAINT seller_workspace_profiles_logo_metadata_pair CHECK (
    (logo_object_key IS NULL AND logo_mime_type IS NULL) OR
    (logo_object_key IS NOT NULL AND logo_mime_type IS NOT NULL)
  ),
  CONSTRAINT seller_workspace_profiles_logo_object_key_safe CHECK (
    logo_object_key IS NULL OR (
      BTRIM(logo_object_key) = logo_object_key AND
      logo_object_key <> '' AND
      LENGTH(logo_object_key) <= 512 AND
      logo_object_key !~ '(^/|\\|://|(^|/)\.\.?(/|$))' AND
      logo_object_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    )
  ),
  CONSTRAINT seller_workspace_profiles_logo_mime_type_safe CHECK (
    logo_mime_type IS NULL OR logo_mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  )
);

CREATE UNIQUE INDEX seller_workspace_profiles_slug_unique
  ON seller_workspace_profiles (slug);
