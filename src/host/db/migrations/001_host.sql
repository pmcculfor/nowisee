-- Host identity, sessions, lockbox, and OAuth state.
-- One file: the product is in development; existing rows need not be preserved.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX users_email ON users (email);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users (id),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE login_challenges (
  session_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE login_throttles (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE lockbox (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_id, slot)
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  code_verifier_key_id TEXT NOT NULL,
  code_verifier_nonce BLOB NOT NULL,
  code_verifier_ciphertext BLOB NOT NULL,
  authorize_url TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX oauth_states_live ON oauth_states (session_id, app_id, slot);
CREATE INDEX oauth_states_expires ON oauth_states (expires_at);
