import { testamentLabel } from "../catalog.ts";
import { bookPathSegment, chapterLabel } from "../canon.ts";
import {
  bookId as bookNodeId,
  bookmarksId,
  chapterId,
  parseNodeId,
  testamentId,
} from "../ids.ts";
import type { NodePayload, StackEntry } from "../../../core/types.ts";
import { bookLabel, canonPath, type ViewSession } from "./helpers.ts";

/**
 * Committed ancestry for `open`. Last entry is the tip. Overlay nodes omit a stack.
 */
export function committedAncestry(
  session: ViewSession,
  tip: NodePayload,
): readonly StackEntry[] | undefined {
  const parsed = parseNodeId(tip.id);
  if (!parsed) {
    return undefined;
  }
  const appId = session.deps.appId;
  const store = session.deps.store;

  if (parsed.kind === "book") {
    const book = store.getBook(parsed.bookId);
    if (!book) {
      return undefined;
    }
    return [
      {
        nodeId: testamentId(book.testament),
        label: testamentLabel(book.testament),
        location: { appId, path: "/" },
      },
      {
        nodeId: tip.id,
        label: tip.label,
        location: { appId, path: `/${bookPathSegment(book.label)}` },
      },
    ];
  }

  if (parsed.kind === "chapter") {
    const book = store.getBook(parsed.bookId);
    if (!book) {
      return undefined;
    }
    return [
      {
        nodeId: testamentId(book.testament),
        label: testamentLabel(book.testament),
        location: { appId, path: "/" },
      },
      {
        nodeId: bookNodeId(book.id),
        label: book.label,
        location: { appId, path: `/${bookPathSegment(book.label)}` },
      },
      {
        nodeId: tip.id,
        label: tip.label,
        location: {
          appId,
          path: `/${bookPathSegment(book.label)}/${parsed.chapter}`,
        },
      },
    ];
  }

  if (parsed.kind !== "verse") {
    return undefined;
  }

  if (parsed.seq.type === "bookmarks") {
    return [
      {
        nodeId: bookmarksId(),
        label: "Bookmarks",
        location: { appId, path: "/bookmarks" },
      },
      {
        nodeId: tip.id,
        label: tip.label,
        location: { appId, path: `/bookmarks${canonPath(store, parsed.ref)}` },
      },
    ];
  }

  if (parsed.seq.type !== "chapter") {
    return undefined;
  }

  const book = store.getBook(parsed.ref.bookId);
  if (!book) {
    return undefined;
  }
  const segment = bookPathSegment(book.label);
  return [
    {
      nodeId: testamentId(book.testament),
      label: testamentLabel(book.testament),
      location: { appId, path: "/" },
    },
    {
      nodeId: bookNodeId(book.id),
      label: bookLabel(store, book.id),
      location: { appId, path: `/${segment}` },
    },
    {
      nodeId: chapterId(book.id, parsed.ref.chapter),
      label: chapterLabel(parsed.ref.chapter),
      location: { appId, path: `/${segment}/${parsed.ref.chapter}` },
    },
    {
      nodeId: tip.id,
      label: tip.label,
      location: { appId, path: canonPath(store, parsed.ref) },
    },
  ];
}
