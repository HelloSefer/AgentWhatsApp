CREATE TABLE IF NOT EXISTS auth_users (
  user_id TEXT PRIMARY KEY,
  email_normalized VARCHAR(320) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_users_user_id_not_blank CHECK (BTRIM(user_id) <> ''),
  CONSTRAINT auth_users_user_id_trimmed CHECK (user_id = BTRIM(user_id)),
  CONSTRAINT auth_users_email_normalized_not_blank CHECK (BTRIM(email_normalized) <> ''),
  CONSTRAINT auth_users_email_normalized_trimmed CHECK (email_normalized = BTRIM(email_normalized)),
  CONSTRAINT auth_users_email_normalized_lowercase CHECK (email_normalized = LOWER(email_normalized)),
  CONSTRAINT auth_users_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_normalized_unique
  ON auth_users (email_normalized);

CREATE TABLE IF NOT EXISTS password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(user_id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT password_credentials_hash_not_blank CHECK (BTRIM(password_hash) <> '')
);

CREATE TABLE IF NOT EXISTS external_identities (
  external_identity_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email_normalized VARCHAR(320),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_identities_id_not_blank CHECK (BTRIM(external_identity_id) <> ''),
  CONSTRAINT external_identities_provider_not_blank CHECK (BTRIM(provider) <> ''),
  CONSTRAINT external_identities_provider_lowercase CHECK (provider = LOWER(provider)),
  CONSTRAINT external_identities_subject_not_blank CHECK (BTRIM(provider_subject) <> ''),
  CONSTRAINT external_identities_email_lowercase CHECK (email_normalized IS NULL OR email_normalized = LOWER(email_normalized))
);

CREATE UNIQUE INDEX IF NOT EXISTS external_identities_provider_subject_unique
  ON external_identities (provider, provider_subject);

CREATE INDEX IF NOT EXISTS external_identities_user_idx
  ON external_identities (user_id, provider);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT auth_sessions_id_not_blank CHECK (BTRIM(session_id) <> ''),
  CONSTRAINT auth_sessions_token_hash_not_blank CHECK (BTRIM(session_token_hash) <> ''),
  CONSTRAINT auth_sessions_token_hash_sha256_hex CHECK (session_token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT auth_sessions_expires_after_created CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_unique
  ON auth_sessions (session_token_hash);

CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
  ON auth_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  email_normalized VARCHAR(320) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT email_verification_tokens_id_not_blank CHECK (BTRIM(token_id) <> ''),
  CONSTRAINT email_verification_tokens_hash_not_blank CHECK (BTRIM(token_hash) <> ''),
  CONSTRAINT email_verification_tokens_hash_sha256_hex CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT email_verification_tokens_email_lowercase CHECK (email_normalized = LOWER(email_normalized)),
  CONSTRAINT email_verification_tokens_expires_after_created CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_hash_unique
  ON email_verification_tokens (token_hash);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_active_idx
  ON email_verification_tokens (user_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT password_reset_tokens_id_not_blank CHECK (BTRIM(token_id) <> ''),
  CONSTRAINT password_reset_tokens_hash_not_blank CHECK (BTRIM(token_hash) <> ''),
  CONSTRAINT password_reset_tokens_hash_sha256_hex CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT password_reset_tokens_expires_after_created CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_unique
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_active_idx
  ON password_reset_tokens (user_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS seller_memberships (
  seller_id TEXT NOT NULL REFERENCES sellers(seller_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ,
  PRIMARY KEY (seller_id, user_id),
  CONSTRAINT seller_memberships_seller_id_not_default CHECK (
    LOWER(REGEXP_REPLACE(BTRIM(seller_id), '[[:space:]_-]+', '-', 'g')) <> 'default-seller'
  ),
  CONSTRAINT seller_memberships_role_check CHECK (role IN ('OWNER', 'ADMIN', 'AGENT', 'VIEWER')),
  CONSTRAINT seller_memberships_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT seller_memberships_disabled_at_matches_status CHECK (
    (status = 'disabled' AND disabled_at IS NOT NULL) OR
    (status = 'active' AND disabled_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS seller_memberships_user_idx
  ON seller_memberships (user_id, seller_id);

CREATE INDEX IF NOT EXISTS seller_memberships_seller_role_idx
  ON seller_memberships (seller_id, role)
  WHERE status = 'active';
