# Notes (`id: "notes"`)

Notes is an ordinary server `AppModule`. Persistence is `NotesStore` on this app’s SQLite file (`data/apps/notes.db`). Every store method takes `ownerId` (`ctx.userId`); the host does not inject the store. See [`docs/STORAGE.md`](../../../docs/STORAGE.md).

Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`store.ts`](store.ts). Tests: [`tests/notes.test.ts`](../../../tests/notes.test.ts) (in-memory SQLite, same store as production).

## Signed out

When `ctx.userId` is null, the tip is **Sign in to use Notes.** `enter` is an `app` edge to `ctx.accountAppId`. `back` goes to Home. No notes are listed or created. Ownership is never `sessionId`.

## Signed in

Open `/` lands on the most recently edited note if there is one, otherwise on **Create a note**. Prev from that first note reaches Create. Create has no prev; the oldest note has no next (the list does not wrap).

List order is **Create a note**, then notes sorted by `updatedAt` descending. List tips show the **first line** of each note body (an empty body is spoken as “Empty note”).

Enter on Create or on a note pushes an input tip with the full body. **Done** (`enter`) commits with `passInputText` and `action: true`. **Cancel** (`back`) returns without saving. Side effects run **only** when `extras.action` is true.

Resolve stack node ids with the owner in the query. A note the user does not own is treated as the default list tip, not as a confirmation that the record exists. On root list tips, `back` is an `app` edge to Home.

## Non-goals

This app does not offer shared multi-device sync beyond this server file, rich text, folders, or delete.
