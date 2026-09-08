import {
  edgeNode,
  rootBackToHome,
  siblingListEdges,
  type MapFragment,
} from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { ROOT_ITEMS, testamentLabel } from "../catalog.ts";
import { chapterLabel, verseNumberLabel } from "../canon.ts";
import {
  bookId as bookNodeId,
  bookmarksEmptyId,
  bookmarksId,
  chapterId,
  searchId,
  searchInputId,
  signInId,
  testamentId,
  verseNodeId,
  versionPickId,
  versionsHeadingId,
} from "../ids.ts";
import { addNode, listedVersions, type ViewSession } from "./helpers.ts";
import { missingVerseLabel } from "../canon.ts";

export function addRootLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  versionId: number,
  currentTestament?: string,
): void {
  const { store, rootAppId } = session.deps;
  const ids = rootHeadingIds(versionId);

  for (const item of ROOT_ITEMS) {
    if (item.type === "testament") {
      addNode(payloads, {
        id: testamentId(versionId, item.testament),
        label: testamentLabel(item.testament),
      });
    } else if (item.type === "bookmarks") {
      addNode(payloads, { id: bookmarksId(), label: "Bookmarks" });
    } else if (item.type === "search") {
      addNode(payloads, { id: searchId(), label: "Search" });
    } else {
      addNode(payloads, { id: versionsHeadingId(), label: "Version" });
    }
  }

  fragments.push(siblingListEdges(ids, { wrap: true }));
  fragments.push(rootEnterEdges(session));

  for (const item of ROOT_ITEMS) {
    if (item.type !== "testament") {
      continue;
    }
    const id = testamentId(versionId, item.testament);
    fragments.push(rootBackToHome(id, rootAppId, session.deps.appId));
    const books = store.listBooks(item.testament);
    const first = books[0];
    if (first) {
      fragments.push({
        [id]: { enter: edgeNode(bookNodeId(versionId, first.id), "push") },
      });
    }
  }
  fragments.push(rootBackToHome(bookmarksId(), rootAppId, session.deps.appId));
  fragments.push(rootBackToHome(searchId(), rootAppId, session.deps.appId));
  fragments.push(rootBackToHome(versionsHeadingId(), rootAppId, session.deps.appId));

  if (currentTestament) {
    for (const book of store.listBooks(currentTestament).slice(0, 8)) {
      addNode(payloads, { id: bookNodeId(versionId, book.id), label: book.label });
    }
  }
}

function rootHeadingIds(versionId: number): string[] {
  return ROOT_ITEMS.map((item) => {
    switch (item.type) {
      case "testament":
        return testamentId(versionId, item.testament);
      case "bookmarks":
        return bookmarksId();
      case "search":
        return searchId();
      case "versions":
        return versionsHeadingId();
    }
  });
}

function rootEnterEdges(session: ViewSession): MapFragment {
  const firstVersion = listedVersions(session)[0];
  const bookmarksEnter = session.userId
    ? firstBookmarkEnter(session)
    : edgeNode(signInId(), "push");
  return {
    [bookmarksId()]: { enter: bookmarksEnter },
    [searchId()]: { enter: edgeNode(searchInputId(), "push") },
    [versionsHeadingId()]: {
      ...(firstVersion ? { enter: edgeNode(versionPickId(firstVersion.id), "push") } : {}),
    },
  };
}

function firstBookmarkEnter(session: ViewSession) {
  const first = session.deps.store.listBookmarks(session.userId!)[0];
  if (!first) {
    return edgeNode(bookmarksEmptyId(), "push");
  }
  return edgeNode(verseNodeId({ type: "bookmarks" }, first), "push");
}

export function addBookLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  versionId: number,
  bookPk: number,
): void {
  const book = session.deps.store.getBook(bookPk);
  if (!book) {
    addRootLevel(session, payloads, fragments, versionId);
    return;
  }
  const siblings = session.deps.store.listBooks(book.testament);
  const ids = siblings.map((b) => bookNodeId(versionId, b.id));
  for (const b of siblings) {
    addNode(payloads, { id: bookNodeId(versionId, b.id), label: b.label });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  const chapters = session.deps.store.listChapters(book.id);
  const firstChapter = chapters[0];
  fragments.push({
    [bookNodeId(versionId, book.id)]: {
      ...(firstChapter
        ? { enter: edgeNode(chapterId(versionId, book.id, firstChapter.number), "replace") }
        : {}),
      back: edgeNode(testamentId(versionId, book.testament), "replace"),
    },
  });
  for (const chapter of chapters.slice(0, 12)) {
    addNode(payloads, {
      id: chapterId(versionId, book.id, chapter.number),
      label: chapterLabel(chapter.number),
    });
  }
  addNode(payloads, {
    id: testamentId(versionId, book.testament),
    label: testamentLabel(book.testament),
  });
}

export function addChapterLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  versionId: number,
  bookPk: number,
  chapterNumber: number,
): void {
  const book = session.deps.store.getBook(bookPk);
  const chapter = session.deps.store.getChapter(bookPk, chapterNumber);
  if (!book || !chapter) {
    addRootLevel(session, payloads, fragments, versionId);
    return;
  }
  const chapters = session.deps.store.listChapters(book.id);
  const ids = chapters.map((ch) => chapterId(versionId, book.id, ch.number));
  for (const ch of chapters) {
    addNode(payloads, {
      id: chapterId(versionId, book.id, ch.number),
      label: chapterLabel(ch.number),
    });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  const readings = session.deps.store.listVerseReadings(versionId, chapter.id);
  const firstReading = readings[0];
  fragments.push({
    [chapterId(versionId, book.id, chapter.number)]: {
      ...(firstReading
        ? {
            enter: edgeNode(
              verseNodeId(
                { type: "chapter", versionId, bookId: book.id, chapter: chapter.number },
                { bookId: book.id, chapter: chapter.number, verse: firstReading.verse },
              ),
              "replace",
            ),
          }
        : {}),
      back: edgeNode(bookNodeId(versionId, book.id), "replace"),
    },
  });
  const version = session.deps.store.getVersion(versionId);
  for (const reading of readings.slice(0, 8)) {
    const text =
      reading.text ??
      missingVerseLabel(book.label, { bookId: book.id, chapter: chapter.number, verse: reading.verse }, version?.label ?? "");
    addNode(payloads, {
      id: verseNodeId(
        { type: "chapter", versionId, bookId: book.id, chapter: chapter.number },
        { bookId: book.id, chapter: chapter.number, verse: reading.verse },
      ),
      label: reading.text ? verseNumberLabel(reading.verse, reading.text) : text,
    });
  }
  addNode(payloads, { id: bookNodeId(versionId, book.id), label: book.label });
}
