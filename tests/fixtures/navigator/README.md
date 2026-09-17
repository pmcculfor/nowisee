# Dual-Navigator fixtures

JSON in this folder is the shared spec for website TypeScript Navigator and iPhone Swift Navigator. Vitest runs it (`tests/navigator-fixtures.test.ts`). `swift test` in `ios/` runs the same files.

`apps/` holds reusable graphs (`standard`, `overlay`). A scenario may set `appsFrom` and overlay extra `apps` keys. Decode-only files have `decode` and no `steps`.

## Scenario shape

```json
{
  "id": "push-then-pop",
  "appsFrom": "standard",
  "config": { "rootAppId": "home", "recentsAppId": "recents", "clipboard": "ok" },
  "apps": {},
  "steps": [
    { "open": { "appId": "fake", "path": "/" } },
    { "intent": "enter" },
    { "setInput": "hello" },
    { "release": "hold-name" },
    {
      "expect": {
        "label": "Child",
        "kind": "text",
        "tipId": "child",
        "stack": ["root", "child"],
        "frames": [null, null],
        "blocked": false,
        "address": { "appId": "fake", "path": "/" },
        "external": "https://example.com",
        "clipboard": "copied-text",
        "lastCall": {
          "method": "refresh",
          "appId": "fake",
          "nodeId": "child",
          "extras": {
            "action": { "triggerId": "copy" },
            "inputText": "hello",
            "parkedAppIds": ["fake"]
          }
        }
      }
    }
  ]
}
```

`expect` fields are optional; omit what the case is not about. `extras.action: null` means the last RPC must not carry `action`.

## Replies

Each `open` path and `refresh` node id maps to one reply object (reused) or an array (consumed in order):

- `{}` — synthesize from `graph` (tip = open path or refresh node id)
- `{ "patch": { "clipboardText": "…", "node": { "id": "a", "label": "A-fresh" } } }`
- `{ "result": { …full RefreshResult wire… } }`
- `{ "error": "transport" | "malformed" }`
- `{ "hold": "name" }` — block until a `{ "release": "name" }` step

A `graph` has `appId`, `nodes`, `map`, `openTips`, and optional `nullLocationIds`.

## What not to put here

Display, gestures, VoiceOver, swipe thresholds, and browser clipboard-during-keydown. Those stay native tests.

When you change Navigator concurrency, park, stack, or decode rules, add or extend a file here in the same change as the TypeScript test.
