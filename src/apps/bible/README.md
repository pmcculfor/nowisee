# Bible (`id: "bible"`)

The Bible app is an ordinary server `AppModule`. It owns a public corpus plus bookmarks and version recency. Core never knows about verses.

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

Graph builders interpret records in [`catalog.ts`](catalog.ts). They do not name individual works. [`view/kinds.ts`](view/kinds.ts) is one table keyed by `ParsedNode` kind (`addLevel`, `payload`, `version`, `location`) so a new node kind is a row, not four `switch`es.

- `CanonBook` — USFM id, sort, testament **string**, label, aliases (URL names).
- `VersionRecord` — `id`, `label`, `sortOrder`, `license` (a seam for licensed translations; unused for gating).
- `CommentaryRecord` — import catalog (`id`, `label`, `sortOrder`, `format`, source path). The graph lists rows from the `commentaries` table, most recently used first.
- `RootItem[]` — testament headings, bookmarks, search, versions.
- `VerseOption[]` — versions, commentary, bookmark, copy.

There is one verse renderer and four sibling policies (`VerseSequence`): chapter (wrap), context (wrap, pop back), bookmarks (no wrap), and search (no wrap, neighborhood warm). Sequence is encoded in the node id, including verse-menu options and version picks.

**Active version:** first row of `version` left-joined to `version_recency` (`used_at DESC`, then catalog `sort_order`). Signed-in lookups use `user_id` only. Signed-out lookups use `session_id`. Session recency older than 14 days is deleted on write. Sign-in does not copy session rows; the account’s recency wins (or catalog order if the account has none). Book, chapter, and verse node ids have no version. Reading URLs are `/Matthew/5/3`. Bookmark URLs are `/bookmarks/Matthew/5/3`. Search stays `/search`.

## Graph

Root (Old Testament, New Testament, Bookmarks, Search, Version) leads to book → chapter → verse → options.

Book lists, chapter lists, and chapter-sequence verses wrap. Context-sequence verses wrap in that chapter the same way. Bookmark and search hits do not. Verse `next` / `prev` in a chapter stay in that chapter.

Chapter labels are `N (chapter)` (number first). Chapter-sequence verses are `N. text`. Search enter lands on a context-sequence verse `N (context). text` so prev/next walk that chapter. Bookmark and search hits are `Book C:V. text`. Copy is `Version. Book C:V. text`.

Reading-tree descend and `back` use `replace` (testament ↔ book ↔ chapter ↔ verse), so a URL-opened verse walks chapter → book → testament the same way in-session reading does. Bookmark and search verses `back` pop. Context verses (from search) `back` pop to the hit. The verse menu **replaces** the verse; option Back replaces onto that verse (the ref is in the option id). Versions enter replaces onto the first pick; pick Back replaces onto Versions. Commentary still pushes. Root `back` is an `app` edge to Home.

- **Copy:** `action: true` on enter from Copy, `replace` onto the same node. The label becomes “Copied” (or a failure line) and the result includes `clipboardText`. Core writes the clipboard. prev/next still walk the verse options.
- **Version:** root and verse-menu lists walk `version` rows, most recently used first (catalog `sort_order` for never-picked rows). Verse-menu Versions lands on the first pick, the same as root Version. Enter is `action: true` on the pick; the result node is the current-sequence verse (or the first testament at root), occupying the same stack slot as the menu, so Back is that verse's back — not Versions. Recency writes for `ctx.userId` when signed in, else `ctx.sessionId`. If the target version has no text for this slot, the verse node says so; **enter** is still the ordinary verse menu (Versions first).
- **Search:** enter pushes an input (Display’s generic `"Input"` name). Done is `action` plus `passInputText`; results replace the input. Tokenize on non-letters, AND of whole words on `verse_text` (word boundaries, no inverted-index table), canon order, cap `SearchPolicy.maxHits`. An empty query or no hits is a text node. If the hit list reaches that cap, the last node is `search limited to N results.` (N is `maxHits`). The query id is session-scoped and stores the version it was run against; hit verse ids are stored with the query (not re-run on each refresh). Hit labels always use that stored version. Enter on a hit pushes a context-sequence verse of the same ref, which uses the **active** version; enter again is the verse menu. One live query per session: a new search deletes that session’s previous rows, and any query older than one day. Refresh warms `SearchPolicy.siblingRadius` neighbors, not the whole list.
- **Bookmarks:** `ctx.userId` only. Signed-out enter is a sign-in node (enter → Account). Never store session-id bookmark rows. The verse-menu Bookmark option is an in-place toggle (“Bookmark” / “Remove bookmark”). Bookmark **display** uses the active version; the bookmark **key** is a verse id (canon slot).
- **Commentary:** works listed from the `commentary` table, most recently used first. Enter a work is `action: true` and lands on the first `splitText` chunk of the most specific section covering this verse (`commentary_section_verse`). Chunks do not wrap. TSK xrefs are stored and flattened into the section label.

Warm nearby books, chapters, and verses as appropriate. Search hits warm a sibling window, not every result.

## Schema

Migrations live in [`db/migrations/001_reader.sql`](db/migrations/001_reader.sql). One file: the product is in development, so existing rows need not be preserved. Delete `data/apps/bible.db` after a schema change.

- `book`, `chapter`, `verse` — canon tree (integer PKs). Books are not per-version.
- `version` (`id`, unique `slug`, `label`, `sort_order`, `license`)
- `verse_text` (`version_id`, `verse_id`, `text`) — the only versioned corpus table
- `version_recency` / `commentary_recency` — MRU; `user_id` **or** `session_id`; first version row is the active version
- `bookmark` (`user_id`, `verse_id`)
- `commentary`, `commentary_section`, `commentary_section_verse`, `commentary_xref`
- `search_query` (one live query per session, `version_id`, 1-day TTL on write) plus `search_hit` (verse ids; not re-run on each refresh)

Commentaries are version-independent. Search scans `verse_text` with whole-word `GLOB`; FTS5 is a later seam.

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
| `view/kinds.ts` | `ParsedNode` kind → version, location, payload, neighborhood |
| `view/*` | Graph builders the table calls |
| `index.ts` | `AppModule`; passes `ctx` |
