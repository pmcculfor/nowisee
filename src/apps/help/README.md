# Help (`id: "help"`)

Help is an ordinary `AppModule` with no database. Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`ids.ts`](ids.ts).

Its catalog label is **Help. Tap the right side of the screen or press the right arrow to enter.** so a first-time visitor hears how to open it from Home.

## Graph

Open lands on the welcome node (the product name as spoken in the copy, one item per page, and a mention of tap edges or arrow keys). `enter` goes to a back-practice node whose `back` pops to welcome.

From there, `enter` reaches four sibling list items that wrap on `next` / `prev`. Only the **fourth** item has an `enter` edge, which leads to a typing prompt and then an input node. The first three list items have no `enter` edge.

Done (`enter` with `passInputText`, no `action`) goes to a closing node that quotes what they typed and sends them Home. Cancel (`back`) returns to the prompt. The closing node’s `enter` and `back` are `app` edges to Home. Welcome `back` is also an `app` edge to Home.

Help must not live on Home as a special node. It authors intents only — no keystrokes in app data.
