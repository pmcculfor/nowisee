# Bible (`id: "bible"`)

The Bible app is an ordinary server `AppModule`. It owns a public corpus plus signed-in bookmarks and version preferences. Core never knows about verses.

Code: [`index.ts`](index.ts), [`store.ts`](store.ts), [`import.ts`](import.ts), [`catalog.ts`](catalog.ts), [`view/`](view/), [`ids.ts`](ids.ts). Corpus files: [`data/SOURCES.md`](data/SOURCES.md). Tests: [`tests/bible.test.ts`](../../../tests/bible.test.ts) (a tiny seed; never the full raw files).

## Works

Only these seven works ship. Do not add copyrighted translations. Do not import e-Sword `.bblx` / `.cmtx` files (they are encrypted). Prefer verse-aligned public-domain files in [`data/raw/`](data/raw/).

| Id | Work | Role | Import |
|----|------|------|--------|
| `kjv` | King James Version (1769) | Bible | `raw/bibles/kjv_vpl/eng-kjv2006_vpl.txt` |
| `asv` | American Standard Version (1901) | Bible | `raw/bibles/asv_vpl/eng-asv_vpl.txt` |
| `bbe` | Bible in Basic English | Bible | `raw/bibles/bbe_vpl/engBBE_vpl.txt` |
| `ylt` | Young’s Literal Translation (1898) | Bible | `raw/bibles/ylt_vpl/engylt_vpl.txt` |
| `tsk` | Treasury of Scripture Knowledge | Commentary | `raw/commentaries/tsk/tskxref.txt` |
| `henry` | Matthew Henry (complete) | Commentary (ranges) | `raw/commentaries/matthew-henry/{BOOK}/{n}.json` |
| `jfb` | Jamieson, Fausset and Brown | Commentary | `raw/commentaries/jamieson-fausset-brown/{BOOK}/{n}.json` |

VPL is one line per verse: `BOOK CHAPTER:VERSE text`. KJV supplied words appear as `[was]`; **keep the words** and strip the brackets only. Henry and JFB come from HelloAO chapter JSON: `content[]` is keyed by starting verse, and a range runs until the next entry. TSK is a tab table; store refs as `commentary_xrefs`.

Import sources under `raw/` that the importer reads are committed. Zips, USFM, and SWORD backups stay gitignored; re-fetch them with `node scripts/download-bible-sources.mjs`. `ensureCatalog(db)` upserts catalog rows and imports, or a tiny test `seed` can stand in.

## Catalogs and sequences

Graph builders interpret records in [`catalog.ts`](catalog.ts). They do not name individual works.

- `CanonBook` — USFM id, sort, testament **string**, label, aliases (URL names).
- `VersionRecord` — `id`, `label`, `sortOrder`, `license` (a seam for licensed translations; unused for gating).
- `CommentaryRecord` — `id`, `label`, `sortOrder`, `format`.
- `RootItem[]` — testament headings, bookmarks, search, versions.
- `VerseOption[]` — versions, commentary, bookmark, copy.

There is one verse renderer and three sibling policies (`VerseSequence`): chapter (wrap), bookmarks (no wrap), and search (no wrap). Sequence is encoded in the node id. Option nodes share a canonical ref.

**Active version:** a signed-in user reads `reader_prefs` keyed by `userId`. A signed-out user uses the URL if present, otherwise the first version by sort. There is no session-pref table. Reading URLs include the version. Bookmark and search **display** use the active version; the bookmark **key** is a canon ref without version.

## Graph

Root (Old Testament, New Testament, Bookmarks, Search, Version) leads to book → chapter → verse → options.

Book lists, chapter lists, and chapter-sequence verses wrap. Bookmark and search hits do not. Verse `next` / `prev` in a chapter stay in that chapter.

Chapter labels are `N (chapter)` (number first). Chapter-sequence verses are `N. text`. Bookmark and search hits are `Book C:V. text`. Copy is `Version. Book C:V. text`.

Reading-tree descend and `back` use `replace` (testament ↔ book ↔ chapter ↔ verse), so a URL-opened verse walks chapter → book → testament the same way in-session reading does. Bookmark and search verses `back` pop. Options `push`. Root `back` is an `app` edge to Home.

- **Copy:** `action: true` on enter from Copy; a “Copying…” status, then `clipboardText` plus “Copied”. Core writes the clipboard. `prev` / `next` over Copy do nothing.
- **Version:** root and verse-menu lists walk `VersionRecord`s, most recently used first. Verse-menu Versions lands on the first pick, the same as root Version. Enter is `action: true` plus a same-app `app` edge (which resets the stack). Prefs write only when `ctx.userId` is set. Recency writes for the signed-in user or the session. A missing verse in the target version clamps to the last verse of that chapter.
- **Search:** enter pushes an input (Display’s generic `"Input"` name). Done is `action` plus `passInputText`; results replace the input. Tokenize on non-letters, AND of whole words, canon order, cap `SearchPolicy.maxHits`. An empty query or no hits is a text node. The query id is session-scoped; hits re-run on refresh.
- **Bookmarks:** `ctx.userId` only. Signed-out enter is a sign-in node (enter → Account). Never store session-id rows. The verse-menu Bookmark option toggles (“Bookmarked” / “Bookmark removed”).
- **Commentary:** a catalog list of works, most recently used first. Enter a work is `action: true` and lands on the first `splitText` chunk of the most specific inclusive range covering this verse. Chunks do not wrap. TSK xrefs are stored and flattened into the section label.

Warm nearby books, chapters, and verses as appropriate.

## Schema

Migrations live in [`db/migrations/001_reader.sql`](db/migrations/001_reader.sql). One file: the product is in development, so existing rows need not be preserved. Delete `data/apps/bible.db` after a schema change.

- `canon_books`, `books` (per version), `verses`, `verse_words` (inverted index; no FTS5)
- `reader_prefs` (`user_id` → `active_version_id`)
- `reader_recency` — recently used versions and commentaries; owner is the signed-in user or the session
- `bookmarks` (`user_id`, book, chapter, verse) — no version
- `commentaries`, range-keyed `commentary_sections`, `commentary_coverage`, `commentary_xrefs`
- `search_queries` (session-scoped text; hits re-run)

`verse_ord` is book sort × 1e6 + chapter × 1e3 + verse. Commentaries are version-independent.

## Seams (not implemented)

Licensed translations (`license` field), navigable commentary xrefs (TSK refs are already flattened into the section label), extra testaments (a string on `CanonBook`), search phrases (the tokenizer is a function), bookmark folders, and a parallel-version UI.

## Layout

| Module | Role |
|--------|------|
| `ids.ts` | Node ids, including sequence prefixes |
| `catalog.ts` | Works, root items, verse options, canon |
| `types.ts` / `store.ts` | SQLite behind `BibleStore` |
| `search.ts` | Tokenize |
| `import.ts` | `ensureCatalog` |
| `view/*` | Graph |
| `index.ts` | `AppModule`; passes `ctx` |
