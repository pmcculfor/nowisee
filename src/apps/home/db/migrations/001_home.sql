-- Per-user Home list. Empty for an owner means default ∪ required.
-- Every read and write includes owner_id ([IDENTITY.md] §9).

CREATE TABLE home_list (
  owner_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (owner_id, app_id)
);

CREATE INDEX home_list_owner_position ON home_list (owner_id, position);
