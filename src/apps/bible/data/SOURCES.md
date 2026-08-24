# Bible corpus sources

Downloaded 2026-08-24 into [`raw/`](raw/). **Import sources are committed** (VPL `*_vpl.txt`, HelloAO chapter JSON, `tsk/tskxref.txt`) so a production clone can seed `data/apps/bible.db`. Zips, USFM, and SWORD backups stay gitignored. Re-fetch backups with `node scripts/download-bible-sources.mjs`.

Do **not** import e-Sword `.bblx`/`.cmtx` blobs (encrypted). Do **not** extend `scripts/prepare-kjv.mjs` brace-stripping. Prefer verse-aligned files below.

## Bibles (66 Protestant books, 31,102 verses each)

All from [eBible.org](https://ebible.org/Scriptures/) (public domain). **Use `_vpl.txt` for import** — one line per verse, `BOOK CHAPTER:VERSE text`, no Strong’s markup. USFM is kept as the tagged original (KJV USFM has `\w word|strong="H1234"\w*`; VPL already flattened that without deleting words).

KJV supplied words appear as `[was]`, `[it was]`, etc. Keep the words; do not strip the brackets with a greedy regex — that is the bug in `prepare-kjv.mjs` / the current `kjv.json` (Genesis 1:2 lost “was”, 1:4 lost “it was”).

| Id | Work | eBible id | Files |
|----|------|-----------|--------|
| `kjv` | King James Version, 1769 Cambridge text, proto-canon only | `eng-kjv2006` | `raw/bibles/kjv_vpl/eng-kjv2006_vpl.txt`, `raw/bibles/kjv_usfm/*.usfm` |
| `asv` | American Standard Version (1901) | `eng-asv` | `raw/bibles/asv_vpl/eng-asv_vpl.txt`, `asv_usfm.zip` |
| `bbe` | Bible in Basic English (US public domain) | `engBBE` | `raw/bibles/bbe_vpl/engBBE_vpl.txt`, `bbe_usfm.zip` |
| `ylt` | Young’s Literal Translation (1898) | `engylt` | `raw/bibles/ylt_vpl/engylt_vpl.txt`, `ylt_usfm.zip` |

Zips: `https://ebible.org/Scriptures/{id}_vpl.zip` and `{id}_usfm.zip`.

UK note: KJV printing in the UK is still restricted by royal letters patent; outside the UK the 1769 text is public domain. BBE: Cambridge confirmed to eBible that US distribution put it in the US public domain.

## Commentaries

### Matthew Henry (complete)

- **Source:** [HelloAO Free Bible API](https://bible.helloao.org/docs/reference/commentaries/) `matthew-henry`
- **License:** [Public Domain Mark](https://creativecommons.org/publicdomain/mark/1.0/)
- **Files:** `raw/commentaries/matthew-henry/{BOOK}/{chapter}.json` (1,174 chapter files; 66 books)
- **Song of Solomon:** HelloAO omits `SNG`. Those eight chapters are filled from the public-domain [lyteword/mhenry-complete](https://github.com/lyteword/mhenry-complete) markdown (CC0), converted into the same HelloAO JSON shape (`raw/commentaries/matthew-henry/SNG/1.json`–`8.json`). Re-fetch with `node scripts/download-bible-sources.mjs sng` (also runs after `commentaries`).
- **Shape:** each chapter has `content[]` entries keyed by starting verse; a section covers a **range** (next entry’s verse − 1). Matches the e-Sword `VerseCommentary` range model.

### Jamieson, Fausset and Brown

- **Source:** HelloAO `jamieson-fausset-brown`
- **License:** Public Domain Mark
- **Files:** `raw/commentaries/jamieson-fausset-brown/{BOOK}/{chapter}.json` (1,185 chapter files)
- **Shape:** same as Henry; mostly one note per verse, some ranges.

Re-download: `node scripts/download-bible-sources.mjs commentaries`

### Treasury of Scripture Knowledge

Two copies; prefer the plaintext table for import:

1. **JustVerses / ariseshinestudio dump** (best for us): `raw/commentaries/tsk/tskxref.txt`  
   Tab-delimited: `book_key`, `chapter`, `verse`, `sort_order`, **phrase**, **reference_list**. ~63k phrase rows. Public domain.  
   https://github.com/ariseshinestudio/TSK

2. **CrossWire SWORD module** (backup, compressed zCom): `raw/sword/tsk.zip`  
   Same work, ThML inside ZIP blocks — needs a SWORD reader. Also `mhc.zip` / `jfb.zip` as backups for Henry/JFB.

## What we are not using

- Existing `kjv.json` + `prepare-kjv.mjs` `{...}` stripper (drops words).
- e-Sword `.bblx` / `.cmtx` modules (deleted; encrypted).
- Extra translations or commentaries not listed above.
