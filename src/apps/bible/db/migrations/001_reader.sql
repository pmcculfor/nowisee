-- Bible corpus and reader tables.
-- One file: the product is in development; existing rows need not be preserved.

CREATE TABLE book (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  testament TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE
);

CREATE TABLE chapter (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES book (id),
  number INTEGER NOT NULL,
  UNIQUE (book_id, number)
);

CREATE TABLE verse (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapter (id),
  number INTEGER NOT NULL,
  UNIQUE (chapter_id, number)
);

CREATE TABLE version (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE,
  license TEXT NOT NULL
);

CREATE TABLE verse_text (
  version_id INTEGER NOT NULL REFERENCES version (id),
  verse_id INTEGER NOT NULL REFERENCES verse (id),
  text TEXT NOT NULL,
  PRIMARY KEY (version_id, verse_id)
);

CREATE TABLE version_recency (
  user_id TEXT,
  session_id TEXT,
  version_id INTEGER NOT NULL REFERENCES version (id),
  used_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) <> (session_id IS NULL))
);

CREATE UNIQUE INDEX version_recency_user ON version_recency (user_id, version_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX version_recency_session ON version_recency (session_id, version_id) WHERE session_id IS NOT NULL;
CREATE INDEX version_recency_user_list ON version_recency (user_id, used_at DESC);
CREATE INDEX version_recency_session_list ON version_recency (session_id, used_at DESC);

CREATE TABLE commentary (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL UNIQUE
);

CREATE TABLE commentary_recency (
  user_id TEXT,
  session_id TEXT,
  commentary_id INTEGER NOT NULL REFERENCES commentary (id),
  used_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) <> (session_id IS NULL))
);

CREATE UNIQUE INDEX commentary_recency_user ON commentary_recency (user_id, commentary_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX commentary_recency_session ON commentary_recency (session_id, commentary_id) WHERE session_id IS NOT NULL;
CREATE INDEX commentary_recency_user_list ON commentary_recency (user_id, used_at DESC);
CREATE INDEX commentary_recency_session_list ON commentary_recency (session_id, used_at DESC);

CREATE TABLE bookmark (
  user_id TEXT NOT NULL,
  verse_id INTEGER NOT NULL REFERENCES verse (id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, verse_id)
);

CREATE INDEX bookmark_user ON bookmark (user_id, created_at);

CREATE TABLE commentary_section (
  id INTEGER PRIMARY KEY,
  commentary_id INTEGER NOT NULL REFERENCES commentary (id),
  body TEXT NOT NULL
);

CREATE TABLE commentary_section_verse (
  section_id INTEGER NOT NULL REFERENCES commentary_section (id) ON DELETE CASCADE,
  verse_id INTEGER NOT NULL REFERENCES verse (id),
  PRIMARY KEY (section_id, verse_id)
);

CREATE INDEX commentary_section_verse_verse ON commentary_section_verse (verse_id);

CREATE TABLE commentary_xref (
  section_id INTEGER NOT NULL REFERENCES commentary_section (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  refs TEXT NOT NULL
);

CREATE TABLE search_query (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  query TEXT NOT NULL,
  version_id INTEGER NOT NULL REFERENCES version (id),
  created_at INTEGER NOT NULL
);

CREATE INDEX search_query_session ON search_query (session_id, created_at);

CREATE TABLE search_hit (
  query_id INTEGER NOT NULL REFERENCES search_query (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  verse_id INTEGER NOT NULL REFERENCES verse (id),
  PRIMARY KEY (query_id, position)
);
