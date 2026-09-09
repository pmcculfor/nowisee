# Tutorial (`id: "tutorial"`)

Tutorial is an ordinary `AppModule` with no database. Its catalog name is **Tutorial app**. Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`ids.ts`](ids.ts).

The catalog label tells a first-time visitor how to enter from Home (arrow key, tap edge, or iPhone swipe) and that up/down reaches other apps.

## Graph

Open lands on welcome. `enter` goes to a tree-structure node, then a back-practice node whose `back` pops. There is no recents node; recents is mentioned on the closing screen.

From back practice, `enter` reaches four sibling list items that wrap on `next` / `prev`. Only the **fourth** item has an `enter` edge, which leads to a typing prompt and then an input node. The first three list items have no `enter` edge.

Done (`enter` with `passInputText`, no `action`) goes to a closing node that quotes what they typed, teaches recents (`r`, iPhone tap and hold for one second, input Recent Apps), and sends them Home on `enter`. Cancel (`back`) on the input returns to the prompt. Closing-node `back` pops to the input. Welcome `back` is an `app` edge to Home.

Tutorial must not live on Home as a special node. The map authors intents only — no keystrokes in edge data. Spoken labels may name keys, taps, and swipes.
