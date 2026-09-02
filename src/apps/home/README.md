# Home (`id: "home"`)

Home is an ordinary `AppModule`. Persistence is `HomeStore` on this app’s SQLite file (`data/apps/home.db`). Every store method takes `ownerId` (`ctx.userId`); the host does not inject the store. See [`docs/STORAGE.md`](../../../docs/STORAGE.md).

Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`store.ts`](store.ts), [`membership.ts`](membership.ts), [`ids.ts`](ids.ts). Tests: [`tests/home.test.ts`](../../../tests/home.test.ts) (in-memory SQLite).

It lists installed apps from `ctx.directory.list()`, which the host grants only to Home. Descriptors include optional `homeRole` from the pack row. Home receives descriptors, **not** the registry object. `AppRegistry.listDescriptors()` stays `{ id, label }` only. `rootAppId` is still the shell root; it is not derived from `homeRole`.

## `homeRole`

| Value | On the home list | Add / Remove | Reorder |
|-------|------------------|--------------|---------|
| `internal` | never | never | never |
| `required` | always | never | yes |
| `default` | until the user removes it | yes | yes |
| `optional` (omit) | only after the user adds it | yes | yes if on the list |

Home also omits its own module id. Pack today: Home `internal`; Help, Bible, Notes `default`; Gmail omit; Account `required`.

## Home list

- Each app label is a node. `enter` is `kind: "app"` to `{ appId, path: "/" }`.
- `open("/app/:id")` lands on that row so leaving an app resumes on the same item.
- `prev` / `next` wrap among labels. **Manage Apps** is always last. At the home list, `back` has no edge.
- Labels are `AppDescriptor.label` as registered.
- Signed out: `required` ∪ `default` in registration order, then Manage Apps. Guests do not persist a layout.
- Signed in with no rows: same membership. The first add, remove, or reorder writes the full ordered set (including `required`). Added apps append before Manage Apps.

## Manage Apps

Signed out: **Sign in to manage apps.** `enter` → `ctx.accountAppId`. `back` → `pop`. Do not use app-kit `signedOut()` (its back would be `/app/home`).

Signed in: **Add Apps**, then **Remove Apps**, then **Reorder Apps** (no wrap). `back` pops to Manage Apps.

- Add: `default` / `optional` not on the list. Enter is `action: true` into **App added to home screen** (`location: null`).
- Remove: `default` / `optional` on the list (never `required`). Enter is `action: true` into **App removed from home screen**.
- Empty lists: **No apps to add.** / **No apps to remove.**
- Reorder: current home apps except Manage Apps. Enter an app **replaces** into Move up / Move down. Enter a move is `action` + `replace` onto a dest that names the direction; refresh returns that app on the list in the new order. First has no Move up; last has no Move down.

Direct URLs to an app that is off the list still work; Home repairs `/app/:id` when that row is missing.
