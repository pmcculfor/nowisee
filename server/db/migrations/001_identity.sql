CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_algo TEXT NOT NULL,
  password_n INTEGER NOT NULL,
  password_r INTEGER NOT NULL,
  password_p INTEGER NOT NULL,
  password_salt BLOB NOT NULL,
  password_hash BLOB NOT NULL,
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
