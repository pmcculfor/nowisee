-- Bible corpus and reader tables.
-- One file: the product is in development; existing rows need not be preserved.

CREATE TABLE canon_books (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  testament TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  aliases TEXT NOT NULL
);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  license TEXT NOT NULL
);

CREATE TABLE books (
  version_id TEXT NOT NULL REFERENCES versions (id),
  book_id TEXT NOT NULL REFERENCES canon_books (id),
  name TEXT NOT NULL,
  PRIMARY KEY (version_id, book_id)
);

CREATE TABLE verses (
  version_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  verse_ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (version_id, book_id, chapter, verse),
  FOREIGN KEY (version_id, book_id) REFERENCES books (version_id, book_id)
);

CREATE INDEX verses_ord ON verses (version_id, verse_ord);
CREATE INDEX verses_chapter ON verses (version_id, book_id, chapter, verse);

CREATE TABLE verse_words (
  version_id TEXT NOT NULL,
  word TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  verse_ord INTEGER NOT NULL,
  PRIMARY KEY (version_id, word, book_id, chapter, verse)
);

CREATE INDEX verse_words_lookup ON verse_words (version_id, word);

CREATE TABLE reader_prefs (
  user_id TEXT PRIMARY KEY,
  active_version_id TEXT NOT NULL REFERENCES versions (id)
);

CREATE TABLE reader_recency (
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  work_kind TEXT NOT NULL,
  work_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (owner_kind, owner_id, work_kind, work_id)
);

CREATE INDEX reader_recency_list ON reader_recency (owner_kind, owner_id, work_kind, used_at DESC);

CREATE TABLE bookmarks (
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_id, chapter, verse)
);

CREATE INDEX bookmarks_user ON bookmarks (user_id, created_at);

CREATE TABLE commentaries (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE commentary_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commentary_id TEXT NOT NULL REFERENCES commentaries (id),
  start_ord INTEGER NOT NULL,
  end_ord INTEGER NOT NULL,
  body TEXT NOT NULL
);

CREATE INDEX commentary_sections_range ON commentary_sections (commentary_id, start_ord, end_ord);

CREATE TABLE commentary_coverage (
  commentary_id TEXT NOT NULL REFERENCES commentaries (id),
  book_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  PRIMARY KEY (commentary_id, book_id, chapter)
);

CREATE TABLE commentary_xrefs (
  section_id INTEGER NOT NULL REFERENCES commentary_sections (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  refs TEXT NOT NULL
);

CREATE TABLE search_queries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX search_queries_session ON search_queries (session_id, created_at);
