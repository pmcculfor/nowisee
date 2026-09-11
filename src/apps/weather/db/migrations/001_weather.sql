-- One saved ZIP per signed-in user. Weather itself is never stored.
-- Every read and write includes user_id ([IDENTITY.md] §9).

CREATE TABLE settings (
  user_id TEXT PRIMARY KEY,
  zip TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
