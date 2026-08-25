-- Recently used versions and commentaries. Owner is a signed-in user or a session.
CREATE TABLE reader_recency (
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  work_kind TEXT NOT NULL,
  work_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (owner_kind, owner_id, work_kind, work_id)
);

CREATE INDEX reader_recency_list ON reader_recency (owner_kind, owner_id, work_kind, used_at DESC);
