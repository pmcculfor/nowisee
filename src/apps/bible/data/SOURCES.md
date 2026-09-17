# Bible corpus sources

Downloaded 2026-08-24 into [`raw/`](raw/). **Import sources are committed** (VPL `*_vpl.txt`, HelloAO chapter JSON, `tsk/tskxref.txt`, Strong’s XML, `alignments/kjv_strongs.tsv`) so a production clone can seed `data/apps/bible.db`. Zips, USFM, and SWORD backups stay gitignored. Re-fetch backups with `node scripts/download-bible-sources.mjs`.

Do **not** import e-Sword `.bblx`/`.cmtx` blobs (encrypted). Prefer verse-aligned files below.

## Bibles (66 Protestant books, 31,102 verses each)

All from [eBible.org](https://ebible.org/Scriptures/) (public domain). **Use `_vpl.txt` for import** — one line per verse, `BOOK CHAPTER:VERSE text`, no Strong’s markup. USFM is the tagged original used only to rebuild `kjv_strongs.tsv`; import does not read USFM.

KJV supplied words appear as `[was]`, `[it was]`, etc. Keep the words; strip the brackets only. Do not strip the brackets with a greedy regex (that deleted “was” from Genesis 1:2 and “it was” from 1:4).

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
   The **phrase** column is a short keyword (usually one or two words), not the print TSK clause heading. CrossReferences.org’s KJV TSV uses the same anchors. CrossWire `tsk.zip` is a compressed zCom module, not a plaintext clause dump. Import recovers headings from King James verse text: this keyword through the next; the first heading starts at the verse.

2. **CrossWire SWORD module** (backup, compressed zCom): `raw/sword/tsk.zip`  
   Same work, ThML inside ZIP blocks — needs a SWORD reader. Also `mhc.zip` / `jfb.zip` as backups for Henry/JFB.

TSK `reference_list` abbreviations (`ge`, `joh`, `jude` vs `jud`, …) are a dedicated map in [`catalog.ts`](../catalog.ts). They are **not** URL aliases.

## Dictionaries

### Strong’s Greek (1890)

- **Source:** [morphgnt/strongs-dictionary-xml](https://github.com/morphgnt/strongs-dictionary-xml) v1.9
- **License:** [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- **File:** `raw/dictionaries/strongs-greek.xml`

### Strong’s Hebrew

- **Source:** [openscriptures/HebrewLexicon](https://github.com/openscriptures/HebrewLexicon) `HebrewStrong.xml`
- **License:** dictionary text is public domain; XML markup is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit: Open Scriptures Hebrew Bible Project.
- **File:** `raw/dictionaries/hebrewstrong.xml`

### King James original-language tokens

eBible KJV USFM tags `\w word|strong="H1234"\w*`. The VPL import has no numbers. A derived table `raw/alignments/kjv_strongs.tsv` (`book`, `chapter`, `verse`, `position`, `strongs`, `english`) is rebuilt from the USFM zip by the download script and is required at import. Consecutive spans that share a Strong’s id collapse; `\add` / notes are dropped; comma-split `strong=` values become two tokens.

## What we are not using

- e-Sword `.bblx` / `.cmtx` modules (deleted; encrypted).
- Extra translations or commentaries not listed above.
- Vine’s Expository Dictionary (US copyright restored under URAA/GATT 1996; CrossWire withdrew the module).
- The withdrawn CrossWire “Thayer” module.
