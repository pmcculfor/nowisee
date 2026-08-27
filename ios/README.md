# Nowisee iPhone client

Thin wrapper: a full-screen `WKWebView` of **https://nowisee.app** plus a transparent Direct Touch overlay. Apps, the server host, and identity are unchanged. Compile and install on a **Mac with Xcode** — this project cannot be built on Windows.

## Open and run (Mac)

1. Open `ios/Nowisee.xcodeproj` in Xcode.
2. Signing & Capabilities → Team → your Apple Account (Personal Team is enough; no $99).
3. Enable Developer Mode on the iPhone (Settings → Privacy & Security).
4. Plug in the phone, pick it as the run destination, Run.
5. Trust the developer certificate: Settings → General → VPN & Device Management.
6. The free profile expires after **7 days**; rebuild from Xcode to renew.

The app icon asset is a placeholder. Xcode may warn until you add a 1024×1024 PNG.

## Gestures (text nodes)

| Gesture | Intent |
| ------- | ------ |
| Swipe right | `enter` — short, fairly diagonal is enough |
| Swipe left | `back` — same |
| Pan down | `next` — first tick at 12% of overlay height, then every 5% |
| Pan up | `prev` — same |

Once the first vertical tick has fired, further movement is only measured on Y: 5% up is another `prev`, 5% down is a `next`, even if the finger also moves sideways. Reversing without lifting the finger walks back through items.

On **input** nodes the overlay hides. VoiceOver uses the web field and Cancel/Done. Off-site pages (OAuth) also hide the overlay.

On text nodes the overlay is a Direct Touch accessibility element (so VoiceOver does not steal swipes) and speaks the node label. The page behind it is hidden from VoiceOver. Leaving an input moves VoiceOver focus back to the overlay so the web surface is not left focused (that caused double-speak and a blue focus box).

## Local site instead of production

Edit `NowiseeOrigin.url` in [`Nowisee/Config.swift`](Nowisee/Config.swift). Session cookies need HTTPS on one origin (`__Host-` + CSRF). A LAN `http://` Vite server will not keep production-style cookies.

## Changes to existing code

The iOS binary is new. These existing files were touched so the page can talk to the wrapper. **No app, host, identity, or Navigator behavior changed.**

| File | What changed |
| ---- | ------------ |
| [`src/core/display.ts`](../src/core/display.ts) | Optional `DisplayHost.onSurfaceChange`. `getLabel()` for the current surface. `onSurfaceChange` runs from `setMode` so a missing parent still notifies. |
| [`src/shell/bootstrap.ts`](../src/shell/bootstrap.ts) | If `webkit.messageHandlers.nowisee` exists, attach [`src/shell/nativeBridge.ts`](../src/shell/nativeBridge.ts) and **do not mount NavPads**. Otherwise behavior is identical (pads still mount in Safari). |
| [`tests/display.test.ts`](../tests/display.test.ts) | Covers `getLabel` / `onSurfaceChange`. |
| [`docs/MODULES.md`](../docs/MODULES.md) | §9c native host; §9b notes pads are skipped under the iOS wrapper. |
| [`README.md`](../README.md) | `ios/` in the layout list. |
| [`.gitignore`](../.gitignore) | Xcode `xcuserdata`. |

New files (not existing-code edits): `src/shell/nativeBridge.ts`, `tests/nativeBridge.test.ts`, this `ios/` tree.

Account deletion was **not** implemented (not required to load the app on your own phone).
