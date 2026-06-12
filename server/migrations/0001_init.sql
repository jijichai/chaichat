-- chaichat initial schema (D1 / SQLite)

CREATE TABLE identities (
  id               TEXT PRIMARY KEY,
  platform         TEXT NOT NULL CHECK (platform IN ('farcaster','world','circles','email')),
  platform_user_id TEXT NOT NULL,        -- fid | world wallet | safe addr (lowercase) | sha256(email)
  did              TEXT NOT NULL,
  handle           TEXT NOT NULL,
  display_name     TEXT,
  avatar_url       TEXT,
  refresh_jwt_enc  TEXT,                 -- AES-GCM; NEVER leaves the backend
  backup_email_set INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL,
  UNIQUE (platform, platform_user_id)    -- one DID per platform identity (anti-farming)
);
CREATE INDEX idx_identities_did ON identities(did);

CREATE TABLE nonces (
  nonce      TEXT PRIMARY KEY,
  platform   TEXT NOT NULL,
  address    TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE email_otps (
  email_hash TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  did        TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE TABLE circles (
  id                  TEXT PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  channel             TEXT NOT NULL,
  community_did       TEXT NOT NULL,
  group_address       TEXT,
  owner_address       TEXT,
  creator_identity_id TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);

CREATE TABLE circle_members (
  circle_id   TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  joined_at   INTEGER NOT NULL,
  trusted_at  INTEGER,
  PRIMARY KEY (circle_id, identity_id)
);

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
