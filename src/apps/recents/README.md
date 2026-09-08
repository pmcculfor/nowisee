# Recents (`id: "recents"`)

Recents is an ordinary `AppModule` with no database. Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`ids.ts`](ids.ts).

It is **not** on Home (`homeRole: "internal"`). Pack `parkable: false` so it does not list itself. The host grants `ctx.directory` so it can turn parked ids into labels.

Navigator opens this app via the reserved `recents` intent and sends `extras.parkedAppIds` (MRU ids only). Home (`rootAppId`) is skipped in the list even though it is parkable, so `back` can still resume Home.

## Graph

- One node per listed parked app. `enter` is `kind: "resume"` to that app.
- `prev` on the first row goes to a **Home** node. `enter` there is a plain `app` edge that **opens** Home. Do not wrap prev from Home.
- `next` walks the listed apps and wraps among them.
- `back` is `kind: "resume"` to `parkedAppIds[0]` (the caller), including Home.
- Empty: “No recent apps…”; `prev` goes to the Home node; `back` resumes the caller if any.
- `location: null`.
