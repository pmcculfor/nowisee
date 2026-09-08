import { ROOT_ITEMS } from "../catalog.ts";
import { bookSortFromPathSegment } from "../canon.ts";
import {
  bookId as bookNodeId,
  bookmarksId,
  chapterId,
  searchId,
  testamentId,
  verseNodeId,
} from "../ids.ts";
import { activeVersion, type ViewSession } from "./helpers.ts";

export function parseBiblePath(session: ViewSession, path: string): string {
  const store = session.deps.store;
  const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts[0] === "bookmarks") {
    return bookmarksId();
  }
  if (parts[0] === "search") {
    return searchId();
  }

  const pathSlug = parts[0] && store.getVersionBySlug(parts[0]) ? parts[0] : null;
  const version = activeVersion(session, pathSlug);
  if (!version) {
    return emptyId();
  }

  if (!pathSlug) {
    return firstRootTip(store, version.id);
  }
  if (parts.length === 1) {
    return firstRootTip(store, version.id);
  }

  const sort = bookSortFromPathSegment(parts[1]!);
  if (sort === null) {
    return firstRootTip(store, version.id);
  }
  const book = store.getBookBySort(sort);
  if (!book) {
    return firstRootTip(store, version.id);
  }
  if (parts.length === 2) {
    return bookNodeId(version.id, book.id);
  }

  const chapterNumber = Number(parts[2]);
  const chapter = store.getChapter(book.id, chapterNumber);
  if (!Number.isInteger(chapterNumber) || !chapter) {
    return bookNodeId(version.id, book.id);
  }
  if (parts.length === 3) {
    return chapterId(version.id, book.id, chapter.number);
  }

  const verseNumber = Number(parts[3]);
  if (!Number.isInteger(verseNumber) || verseNumber < 1) {
    return chapterId(version.id, book.id, chapter.number);
  }
  const slot = store.getVerseSlot(book.id, chapter.number, verseNumber);
  if (!slot) {
    return chapterId(version.id, book.id, chapter.number);
  }
  return verseNodeId(
    { type: "chapter", versionId: version.id, bookId: book.id, chapter: chapter.number },
    { bookId: book.id, chapter: chapter.number, verse: slot.number },
  );
}

function firstRootTip(store: ViewSession["deps"]["store"], versionId: number): string {
  for (const item of ROOT_ITEMS) {
    if (item.type === "testament") {
      const books = store.listBooks(item.testament);
      if (books.length > 0) {
        return testamentId(versionId, item.testament);
      }
    }
  }
  return emptyId();
}

export function emptyId(): string {
  return "bible:empty";
}
