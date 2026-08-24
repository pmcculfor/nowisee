-- Gmail cache and compose drafts. Tokens stay in the host lockbox.
-- Every read and write includes owner_id ([IDENTITY.md] §9).

CREATE TABLE inbox_meta (
  owner_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  from_header TEXT NOT NULL,
  subject TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (owner_id, message_id)
);

CREATE INDEX inbox_meta_owner_position ON inbox_meta (owner_id, position);

CREATE TABLE compose_drafts (
  owner_id TEXT PRIMARY KEY,
  to_addr TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  send_ok INTEGER,
  send_message TEXT,
  updated_at TEXT NOT NULL
);
