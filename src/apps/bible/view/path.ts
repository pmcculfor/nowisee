import { ROOT_ITEMS } from "../catalog.ts";
import { bookIdFromPathSegment } from "../canon.ts";
import {
  bookId as bookNodeId,
  bookmarksId,
  chapterId,
  searchId,
  testamentId,
  verseNodeId,
} from "../ids.ts";
import type { BibleStore } from "../types.ts";
import { activeVersion, clampVerse, type ViewSession } from "./helpers.ts";

export function parseBiblePath(session: ViewSession, path: string): string {
  const store = session.deps.store;
  const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts[0] === "bookmarks") {
    return bookmarksId();
  }
  if (parts[0] === "search") {
    return searchId();
  }

  const pathVersion = parts[0] && store.getVersion(parts[0]) ? parts[0] : null;
  const version = activeVersion(session, pathVersion);

  if (!pathVersion) {
    return firstRootTip(store, version);
  }
  if (parts.length === 1) {
    return firstRootTip(store, version);
  }

  const bookId = bookIdFromPathSegment(parts[1]!);
  if (!bookId) {
    return firstRootTip(store, version);
  }
  const book = store.getBook(version, bookId);
  if (!book) {
    return firstRootTip(store, version);
  }
  if (parts.length === 2) {
    return bookNodeId(version, book.bookId);
  }

  const chapter = Number(parts[2]);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapterCount) {
    return bookNodeId(version, book.bookId);
  }
  if (parts.length === 3) {
    return chapterId(version, book.bookId, chapter);
  }

  const verse = Number(parts[3]);
  if (!Number.isInteger(verse) || verse < 1) {
    return chapterId(version, book.bookId, chapter);
  }
  const clamped = clampVerse(store, version, book.bookId, chapter, verse);
  if (!clamped) {
    return chapterId(version, book.bookId, chapter);
  }
  return verseNodeId(
    { type: "chapter", versionId: version, bookId: book.bookId, chapter },
    clamped,
  );
}

function firstRootTip(store: BibleStore, version: string): string {
  for (const item of ROOT_ITEMS) {
    if (item.type === "testament") {
      const books = store.listBooks(version, item.testament);
      if (books.length > 0) {
        return testamentId(version, item.testament);
      }
    }
  }
  return emptyId();
}

export function emptyId(): string {
  return "bible:empty";
}
