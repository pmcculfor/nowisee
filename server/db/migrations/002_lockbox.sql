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
