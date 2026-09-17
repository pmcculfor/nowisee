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
| `henry` | Matthew Henry (complete) | Commentary (ranges) | `raw/commentaries/matthew-henry/{BOOK}/{n}.json` |
| `jfb` | Jamieson, Fausset and Brown | Commentary | `raw/commentaries/jamieson-fausset-brown/{BOOK}/{n}.json` |
| `tsk` | Treasury of Scripture Knowledge | Cross-references | `raw/commentaries/tsk/tskxref.txt` |
| `strongs` | Strong's Concordance (King James wording) | Dictionary | `raw/dictionaries/strongs-greek.xml`, `hebrewstrong.xml`, `raw/alignments/kjv_strongs.tsv` |

VPL is one line per verse: `BOOK CHAPTER:VERSE text`. KJV supplied words appear as `[was]`; **keep the words** and strip the brackets only. Henry and JFB come from HelloAO chapter JSON: `content[]` is keyed by starting verse, and a range runs until the next entry. TSK is a tab table of phrase → citation string; import expands each citation into one `xref_ref` row per existing verse slot. Strong’s XML is lemma plus definition; the token TSV is collapsed KJV USFM `\w` spans (original-language words). Vine’s is not shipped (US copyright restored).

Import sources under `raw/` that the importer reads are committed. Missing or empty files fail the import; there is no USFM or partial-corpus stand-in. Zips, USFM, and SWORD backups stay gitignored; re-fetch them with `node scripts/download-bible-sources.mjs` (that also rebuilds `kjv_strongs.tsv` from the KJV USFM zip). `ensureCatalog(db)` upserts catalog rows and imports, or a tiny test `seed` can stand in. After this schema, delete `data/apps/bible.db` so the first boot reseeds.

## Catalogs and sequences

Graph builders interpret records in [`catalog.ts`](catalog.ts). They do not name individual works. [`view/kinds.ts`](view/kinds.ts) is one table keyed by `ParsedNode` kind (`addLevel`, `payload`, `version`, `location`) so a new node kind is a row, not four `switch`es.

- `CanonBook` — USFM id, sort, testament **string**, label, aliases (URL names).
- `VersionRecord` — `id`, `abbreviation` (citation token, e.g. KJV), `label`, `sortOrder`, `license` (a seam for licensed translations; unused for gating).
- `CommentaryRecord` — import catalog (`id`, `label`, `sortOrder`, `format`, source path). The graph lists rows from the `commentary` table, most recently used first.
- `XrefRecord` / `DictionaryRecord` — same pattern for cross-reference chains and lexicons. TSK abbreviations live in `TSK_ABBREVS`, not in `CanonBook.aliases` (`/ge` must not become Genesis).
- `RootItem[]` — testament headings, bookmarks, search, versions.
- `VerseOption[]` — versions, commentary, cross-references, dictionaries, bookmark, copy.

There is one verse renderer and five sibling policies (`VerseSequence`): chapter (wrap), context (wrap, pop back), bookmarks (no wrap), search (no wrap, neighborhood warm), and xref (no wrap, neighborhood warm). Sequence is encoded in the node id, including verse-menu options and version picks.

**Active version:** first row of `version` left-joined to `version_recency` (`used_at DESC`, then catalog `sort_order`). Signed-in lookups use `user_id` only. Signed-out lookups use `session_id`. Session recency older than 14 days is deleted on write. Sign-in does not copy session rows; the account’s recency wins (or catalog order if the account has none). Book, chapter, and verse node ids have no version. Reading URLs are `/Matthew/5/3`. Bookmark URLs are `/bookmarks/Matthew/5/3`. Search stays `/search`.

## Graph

Root (Old Testament, New Testament, Bookmarks, Search, Version) leads to book → chapter → verse → options.

Book lists, chapter lists, and chapter-sequence verses wrap. Context-sequence verses wrap in that chapter the same way. Bookmark and search hits do not. Verse `next` / `prev` in a chapter stay in that chapter.

Chapter labels are `N (chapter)` (number first). Chapter-sequence verses are `N. text`. Search and bookmark-list enter land on a context-sequence verse `N (context). text` so prev/next walk that chapter. Bookmark and search hits are `Book C:V. text`. Copy is `Book C:V. text (Abbrev)`.

Reading-tree descend is `push`; peers `replace`; `back` is `pop`. `open("/John/3/16")` returns committed ancestry so a deep link walks chapter → book → testament. The verse menu is a two-level overlay (`frame: "verse-menu"`): verse `pushTransient` onto the first option; option peers `replace`; Versions `pushTransient` onto the first pick (same frame); pick confirm is `popTransient` + `action`. Commentary, Cross-references, and Dictionaries push (committed). Root Version is the same overlay shape with `frame: "root-versions"`. Root `back` is an `app` edge to Home.

- **Copy / Bookmark:** `stay` + `action`. Copy must change the label to “Copied” (or a failure line) and include `clipboardText`. Bookmark toggles “Bookmark” / “Remove bookmark” in place.
- **Version:** root and verse-menu lists walk `version` rows, most recently used first. Enter on a pick is `action` + `popTransient`; `triggerId` is the pick, the refresh tip is the verse (or Version heading at root). Recency writes for `ctx.userId` when signed in, else `ctx.sessionId`. If the target version has no text for this slot, the verse node says so; **enter** is still the ordinary verse menu (Versions first).
- **Search:** enter pushes an input (Display’s generic `"Input"` name). Done is `action` plus `passInputText`; results replace the input. Tokenize on non-letters, AND of whole words on `verse_text` (word boundaries, no inverted-index table), canon order, cap `SearchPolicy.maxHits`. An empty query or no hits is a text node. If the hit list reaches that cap, the last node is `search limited to N results.` (N is `maxHits`). The query id is session-scoped and stores the version it was run against; hit verse ids are stored with the query (not re-run on each refresh). Hit labels always use that stored version. Enter on a hit pushes a context-sequence verse of the same ref, which uses the **active** version; enter again is the verse menu. One live query per session: a new search deletes that session’s previous rows, and any query older than one day. Refresh warms `SearchPolicy.siblingRadius` neighbors, not the whole list.
- **Bookmarks:** `ctx.userId` only. Signed-out enter is a sign-in node (enter → Account). Never store session-id bookmark rows. The verse-menu Bookmark option is an in-place toggle (“Bookmark” / “Remove bookmark”). Bookmark **display** uses the active version; the bookmark **key** is a verse id (canon slot). Enter on a list verse pushes a context-sequence verse of that slot, same as search; enter again is the verse menu.
- **Commentary:** works listed from the `commentary` table, most recently used first. Enter a work is `action: true` and lands on the first `splitText` chunk of the most specific section covering this verse (`commentary_section_verse`). `triggerId` is the work; recency writes from that, not the chunk. Chunks do not wrap. TSK is not a commentary.
- **Cross-references:** enter lands on the work list (one node until a second xref work exists). Enter a work is `action: true` and lands on the first TSK phrase for this verse. Up/Down walk phrases (no wrap). Enter a phrase to walk target verses (one xref-sequence verse each; long lists warm `XREF_POLICY.siblingRadius`). Enter a target pushes a context-sequence verse of that slot; that verse’s own menu includes Cross-references again. Depth is the session stack; leave with repeated Back (or Recents). Phrase and target lists keep the **source** verse in the address bar. A related verse URL is that verse. Missing phrases: a node that says so. TSK dump “phrase” cells are short keywords; import recovers the print heading as the KJV clause from that keyword through the next (the first heading starts at the verse).
- **Dictionaries:** enter lands on the work list (one node until a second dictionary exists). Enter a work is `action: true` and lands on the first original-language word of this verse (King James alignment, even if the reader is on ASV). Up/Down walk `verse_token.position`; tokens do not wrap. The node speaks English surface, transliteration, Strong’s id, and the **full** definition. Enter is a no-op. Untagged / `\add` English is omitted; consecutive USFM spans that share a number collapse. Missing tokens: a node that says so.

Warm nearby books, chapters, and verses as appropriate. Search hits, xref targets, xref phrases, and dictionary words warm a sibling window, not every row.

## Schema

Migrations live in [`db/migrations/001_reader.sql`](db/migrations/001_reader.sql). One file: the product is in development, so existing rows need not be preserved. Delete `data/apps/bible.db` after a schema change.

- `book`, `chapter`, `verse` — canon tree (integer PKs). Books are not per-version.
- `version` (`id`, `label`, `abbreviation`, `sort_order`, `license`)
- `verse_text` (`version_id`, `verse_id`, `text`) — reading surface per translation
- `version_recency` / `commentary_recency` / `xref_recency` / `dictionary_recency` — MRU; `user_id` **or** `session_id`; first version row is the active version
- `bookmark` (`user_id`, `verse_id`)
- `commentary`, `commentary_section`, `commentary_section_verse`
- `xref_work`, `xref_phrase` (work + source verse + TSK heading), `xref_ref` (one target verse per row)
- `dictionary_work`, `dictionary_entry` (lemma / translit / full body keyed by Strong’s id)
- `verse_token` (canon verse × original-language word; King James English surface; no FK to `dictionary_entry`)
- `search_query` (one live query per session, `version_id`, 1-day TTL on write) plus `search_hit` (verse ids; not re-run on each refresh)

Commentaries, xrefs, and dictionary entries are version-independent. Search scans `verse_text` with whole-word `GLOB`; FTS5 is a later seam. `verse_text`, `xref_phrase`, and `verse_token` all join `verse.id` but are three documents, not three copies of one verse.

## Seams (not implemented)

Licensed translations (`license` field), a print concordance (enter from a dictionary word; `verse_token.strongs` is already indexed), extra testaments (a string on `CanonBook`), search phrases (the tokenizer is a function), bookmark folders, and a parallel-version UI.

## Layout

| Module | Role |
|--------|------|
| `ids.ts` | Node ids, including sequence prefixes |
| `catalog.ts` | Works, root items, verse options, canon |
| `types.ts` / `store.ts` | SQLite behind `BibleStore` |
| `search.ts` | Tokenize |
| `import.ts` | `ensureCatalog` |
| `tskCitations.ts` / `usfmTokens.ts` / `strongsXml.ts` | TSK range expand, USFM collapse, Strong’s XML |
| `view/kinds.ts` | `ParsedNode` kind → version, location, payload, neighborhood |
| `view/xref.ts` / `view/dictionary.ts` | Cross-references and dictionary graph builders |
| `view/*` | Graph builders the table calls |
| `index.ts` | `AppModule`; passes `ctx` |
