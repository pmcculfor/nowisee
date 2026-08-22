-- Bible app corpus. Version is a first-class key so later translations
-- are more rows, not a new database.

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE books (
  version_id TEXT NOT NULL REFERENCES versions (id),
  name TEXT NOT NULL,
  abbrev TEXT NOT NULL,
  testament TEXT NOT NULL CHECK (testament IN ('OT', 'NT')),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (version_id, name)
);

CREATE INDEX books_testament ON books (version_id, testament, sort_order);

CREATE TABLE verses (
  version_id TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (version_id, book, chapter, verse),
  FOREIGN KEY (version_id, book) REFERENCES books (version_id, name)
);

CREATE INDEX verses_chapter ON verses (version_id, book, chapter, verse);

-- Future: per-user or per-session saved verses. Unused in this slice.
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'session')),
  owner_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES versions (id),
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (owner_kind, owner_id, version_id, book, chapter, verse)
);

-- Future: named commentary sources and per-verse notes. Unused in this slice.
CREATE TABLE commentaries (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE commentary_notes (
  commentary_id TEXT NOT NULL REFERENCES commentaries (id),
  version_id TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (commentary_id, version_id, book, chapter, verse)
);

-- Future: search results hang on a session, not a user. Unused in this slice.
CREATE TABLE search_queries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX search_queries_session ON search_queries (session_id, created_at);

CREATE TABLE search_hits (
  query_id TEXT NOT NULL REFERENCES search_queries (id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  version_id TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  PRIMARY KEY (query_id, rank)
);
