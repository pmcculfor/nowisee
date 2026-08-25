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

export function addRootLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  version: string,
  currentTestament?: string,
): void {
  const { store, rootAppId } = session.deps;
  const ids = rootHeadingIds(version);

  for (const item of ROOT_ITEMS) {
    if (item.type === "testament") {
      addNode(payloads, {
        id: testamentId(version, item.testament),
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
    const id = testamentId(version, item.testament);
    fragments.push(rootBackToHome(id, rootAppId, session.deps.appId));
    const books = store.listBooks(version, item.testament);
    const first = books[0];
    if (first) {
      fragments.push({
        [id]: { enter: edgeNode(bookNodeId(version, first.bookId), "push") },
      });
    }
  }
  fragments.push(rootBackToHome(bookmarksId(), rootAppId, session.deps.appId));
  fragments.push(rootBackToHome(searchId(), rootAppId, session.deps.appId));
  fragments.push(rootBackToHome(versionsHeadingId(), rootAppId, session.deps.appId));

  if (currentTestament) {
    for (const book of store.listBooks(version, currentTestament).slice(0, 8)) {
      addNode(payloads, { id: bookNodeId(version, book.bookId), label: book.name });
    }
  }
}

function rootHeadingIds(version: string): string[] {
  return ROOT_ITEMS.map((item) => {
    switch (item.type) {
      case "testament":
        return testamentId(version, item.testament);
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
  version: string,
  bookId: string,
): void {
  const book = session.deps.store.getBook(version, bookId);
  if (!book) {
    addRootLevel(session, payloads, fragments, version);
    return;
  }
  const siblings = session.deps.store.listBooks(version, book.testament);
  const ids = siblings.map((b) => bookNodeId(version, b.bookId));
  for (const b of siblings) {
    addNode(payloads, { id: bookNodeId(version, b.bookId), label: b.name });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  fragments.push({
    [bookNodeId(version, book.bookId)]: {
      enter: edgeNode(chapterId(version, book.bookId, 1), "replace"),
      back: edgeNode(testamentId(version, book.testament), "replace"),
    },
  });
  for (let ch = 1; ch <= Math.min(book.chapterCount, 12); ch++) {
    addNode(payloads, {
      id: chapterId(version, book.bookId, ch),
      label: chapterLabel(ch),
    });
  }
  addNode(payloads, {
    id: testamentId(version, book.testament),
    label: testamentLabel(book.testament),
  });
}

export function addChapterLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  version: string,
  bookId: string,
  chapter: number,
): void {
  const book = session.deps.store.getBook(version, bookId);
  if (!book) {
    addRootLevel(session, payloads, fragments, version);
    return;
  }
  const ids: string[] = [];
  for (let ch = 1; ch <= book.chapterCount; ch++) {
    const id = chapterId(version, book.bookId, ch);
    ids.push(id);
    addNode(payloads, { id, label: chapterLabel(ch) });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  fragments.push({
    [chapterId(version, book.bookId, chapter)]: {
      enter: edgeNode(
        verseNodeId(
          { type: "chapter", versionId: version, bookId: book.bookId, chapter },
          { bookId: book.bookId, chapter, verse: 1 },
        ),
        "replace",
      ),
      back: edgeNode(bookNodeId(version, book.bookId), "replace"),
    },
  });
  const verses = session.deps.store.listVerses(version, book.bookId, chapter).slice(0, 8);
  for (const verse of verses) {
    addNode(payloads, {
      id: verseNodeId(
        { type: "chapter", versionId: version, bookId: book.bookId, chapter },
        verse,
      ),
      label: verseNumberLabel(verse.verse, verse.text),
    });
  }
  addNode(payloads, { id: bookNodeId(version, book.bookId), label: book.name });
}
