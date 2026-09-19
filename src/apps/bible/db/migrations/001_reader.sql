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

CREATE TABLE xref_work (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL UNIQUE
);

CREATE TABLE xref_recency (
  user_id TEXT,
  session_id TEXT,
  xref_work_id INTEGER NOT NULL REFERENCES xref_work (id),
  used_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) <> (session_id IS NULL))
);

CREATE UNIQUE INDEX xref_recency_user ON xref_recency (user_id, xref_work_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX xref_recency_session ON xref_recency (session_id, xref_work_id) WHERE session_id IS NOT NULL;
CREATE INDEX xref_recency_user_list ON xref_recency (user_id, used_at DESC);
CREATE INDEX xref_recency_session_list ON xref_recency (session_id, used_at DESC);

CREATE TABLE xref_phrase (
  id INTEGER PRIMARY KEY,
  xref_work_id INTEGER NOT NULL REFERENCES xref_work (id),
  verse_id INTEGER NOT NULL REFERENCES verse (id),
  sort_order INTEGER NOT NULL,
  phrase TEXT NOT NULL,
  UNIQUE (xref_work_id, verse_id, sort_order)
);

CREATE INDEX xref_phrase_verse ON xref_phrase (verse_id, xref_work_id, sort_order);

CREATE TABLE xref_ref (
  phrase_id INTEGER NOT NULL REFERENCES xref_phrase (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  verse_id INTEGER NOT NULL REFERENCES verse (id),
  PRIMARY KEY (phrase_id, sort_order),
  UNIQUE (phrase_id, verse_id)
);

CREATE INDEX xref_ref_verse ON xref_ref (verse_id);

CREATE TABLE dictionary_work (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL UNIQUE
);

CREATE TABLE dictionary_recency (
  user_id TEXT,
  session_id TEXT,
  dictionary_work_id INTEGER NOT NULL REFERENCES dictionary_work (id),
  used_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) <> (session_id IS NULL))
);

CREATE UNIQUE INDEX dictionary_recency_user ON dictionary_recency (user_id, dictionary_work_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX dictionary_recency_session ON dictionary_recency (session_id, dictionary_work_id) WHERE session_id IS NOT NULL;
CREATE INDEX dictionary_recency_user_list ON dictionary_recency (user_id, used_at DESC);
CREATE INDEX dictionary_recency_session_list ON dictionary_recency (session_id, used_at DESC);

CREATE TABLE dictionary_entry (
  dictionary_work_id INTEGER NOT NULL REFERENCES dictionary_work (id),
  strongs TEXT NOT NULL,
  lemma TEXT NOT NULL,
  translit TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE (dictionary_work_id, strongs)
);

CREATE TABLE verse_token (
  verse_id INTEGER NOT NULL REFERENCES verse (id),
  position INTEGER NOT NULL,
  strongs TEXT NOT NULL,
  english TEXT NOT NULL,
  PRIMARY KEY (verse_id, position)
);

CREATE INDEX verse_token_strongs ON verse_token (strongs);

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
