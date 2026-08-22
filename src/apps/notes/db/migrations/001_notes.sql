-- Notes owned by a signed-in user. Never keyed by session_id.
-- Every read and write includes owner_id ([IDENTITY.md] §9).

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX notes_owner_updated ON notes (owner_id, updated_at DESC);
