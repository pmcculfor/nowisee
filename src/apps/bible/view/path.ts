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
    return parseBookmarkPath(session, parts.slice(1));
  }
  if (parts[0] === "search") {
    return searchId();
  }

  if (!activeVersion(session)) {
    return emptyId();
  }
  if (parts.length === 0) {
    return firstTestamentId(store);
  }

  const sort = bookSortFromPathSegment(parts[0]!);
  if (sort === null) {
    return firstTestamentId(store);
  }
  const book = store.getBookBySort(sort);
  if (!book) {
    return firstTestamentId(store);
  }
  if (parts.length === 1) {
    return bookNodeId(book.id);
  }

  const chapterNumber = Number(parts[1]);
  const chapter = store.getChapter(book.id, chapterNumber);
  if (!Number.isInteger(chapterNumber) || !chapter) {
    return bookNodeId(book.id);
  }
  if (parts.length === 2) {
    return chapterId(book.id, chapter.number);
  }

  const verseNumber = Number(parts[2]);
  if (!Number.isInteger(verseNumber) || verseNumber < 1) {
    return chapterId(book.id, chapter.number);
  }
  const slot = store.getVerseSlot(book.id, chapter.number, verseNumber);
  if (!slot) {
    return chapterId(book.id, chapter.number);
  }
  return verseNodeId(
    { type: "chapter", bookId: book.id, chapter: chapter.number },
    { bookId: book.id, chapter: chapter.number, verse: slot.number },
  );
}

function parseBookmarkPath(session: ViewSession, parts: readonly string[]): string {
  if (parts.length < 3 || !session.userId) {
    return bookmarksId();
  }
  const sort = bookSortFromPathSegment(parts[0]!);
  if (sort === null) {
    return bookmarksId();
  }
  const book = session.deps.store.getBookBySort(sort);
  const chapterNumber = Number(parts[1]);
  const verseNumber = Number(parts[2]);
  if (!book || !Number.isInteger(chapterNumber) || !Number.isInteger(verseNumber) || verseNumber < 1) {
    return bookmarksId();
  }
  const slot = session.deps.store.getVerseSlot(book.id, chapterNumber, verseNumber);
  if (!slot || !session.deps.store.isBookmarked(session.userId, slot.id)) {
    return bookmarksId();
  }
  return verseNodeId(
    { type: "bookmarks" },
    { bookId: book.id, chapter: chapterNumber, verse: slot.number },
  );
}

export function firstTestamentId(store: ViewSession["deps"]["store"]): string {
  for (const item of ROOT_ITEMS) {
    if (item.type === "testament") {
      const books = store.listBooks(item.testament);
      if (books.length > 0) {
        return testamentId(item.testament);
      }
    }
  }
  return emptyId();
}

export function emptyId(): string {
  return "bible:empty";
}
