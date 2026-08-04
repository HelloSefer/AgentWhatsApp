ALTER TABLE sellers
  ADD COLUMN workspace_purpose VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
  ADD CONSTRAINT sellers_workspace_purpose_supported
    CHECK (workspace_purpose IN ('STANDARD', 'DEVELOPMENT'));

CREATE UNIQUE INDEX sellers_one_development_workspace_idx
  ON sellers (workspace_purpose)
  WHERE workspace_purpose = 'DEVELOPMENT';
