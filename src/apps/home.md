# Home (`id: "home"`)

Home is an ordinary `AppModule`. Code: [`home.ts`](home.ts).

It lists installed apps from `ctx.directory.list()`, which the host grants only to Home. It receives descriptors, **not** the registry object.

- `open("/app/:id")` lands on that catalog row so that leaving an app resumes on the same item.
- Each app label is a node. `enter` is `kind: "app"` to `{ appId, path: "/" }`.
- `prev` / `next` move among labels with `replace`. The short list wraps.
- At the home root, `back` has no edge (the user is already home).
- Catalog order is registration order minus Home itself. Help is registered first among peers so it is the first Home item.
- Home shows `AppDescriptor.label` as registered. It does not rewrite a peer’s catalog label or embed other apps’ node ids.
