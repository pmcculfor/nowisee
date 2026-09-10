# Lists (`id: "lists"`)

Lists is an ordinary server `AppModule`. Persistence is `ListsStore` on this app’s SQLite file (`data/apps/lists.db`). Every store method takes `ownerId` (`ctx.userId`). Item rows have no `owner_id`; queries `JOIN list` and filter `list.owner_id`. The host does not inject the store. See [`docs/STORAGE.md`](../../../docs/STORAGE.md).

Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`store.ts`](store.ts). Tests: [`tests/lists.test.ts`](../../../tests/lists.test.ts) (in-memory SQLite, same store as production).

## Signed out

When `ctx.userId` is null, the tip is **Sign in to use Lists.** `enter` is an `app` edge to `ctx.accountAppId`. `back` goes to Home. No lists are listed or created. Ownership is never `sessionId`.

## Catalog

Open `/` lands on the most recently updated list if there is one, otherwise on **Create a list**. Prev from that first title reaches Create. Create has no prev; the oldest-updated list has no next (the catalog does not wrap).

List order is **Create a list**, then lists sorted by `updatedAt` descending. Creating a list, adding an item, completing, or restoring bumps that list’s `updatedAt`.

Enter on Create pushes an input for the title. **Done** commits with `passInputText` and `action: true` and lands inside the new list on **Add an item**. **Cancel** returns without saving. Empty (trimmed) text does not write a row.

Enter on a title **pushes** into that list, landing on the first active item (oldest `updatedAt`), or on **Add an item** if the list is empty. On catalog tips, `back` is an `app` edge to Home.

## Inside a list

Chrome sits above the items. From the first active item, `prev` reaches **Add an item**, then **Completed items**, then **Delete this list**. Active items are oldest `updatedAt` first. `back` pops to the catalog title when the stack has a parent; on a one-entry (deep-linked) stack it replaces onto that list’s catalog row.

Enter on Add opens an input. Done creates the item and lands back on **Add an item** (the new row is at the bottom). Empty text does not write.

Enter on an active item is `action: true` and pushes **Completed.** Left **or** right pops back into the list (refresh repairs a now-completed tip onto the remaining active items, or Add). Down from Completed is **Undo complete**; right on that restores (`action: true`) and lands on **Restored.** Left from Undo pops without restoring.

Enter on Completed items pushes the completed list (most recently completed first), or **No completed items.** Enter on a completed item restores it and lands on **Restored.** Restored rows rejoin the active list by the new `updatedAt` (bottom).

Enter on Delete pushes **This list will be permanently deleted.** (not an action). Enter on that confirmation deletes. Aftermath is **List deleted.** Left or right is an `app` edge to this app’s `/`. Cancel on the confirmation pops to Delete.

Side effects run **only** when `extras.action` is true. Status tips use `location: null`.

Resolve stack node ids with the owner in the query (items via the list join). A list or item the user does not own is treated as the default catalog tip, not as a confirmation that the record exists.

## Non-goals

This app does not offer rename, item delete, reorder, sharing, quantities, or due dates.
