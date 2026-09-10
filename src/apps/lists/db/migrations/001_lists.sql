-- Lists owned by a signed-in user. Never keyed by session_id.
-- list_item has no owner_id: every item query JOINs list and filters list.owner_id
-- ([IDENTITY.md] §9).

CREATE TABLE list (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE list_item (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES list(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX list_owner_updated ON list (owner_id, updated_at DESC);
CREATE INDEX list_item_list ON list_item (list_id, completed_at, updated_at);
