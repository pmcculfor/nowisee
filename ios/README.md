# Nowisee iPhone client

Swift shell: Navigator, cookieed `POST /api/apps/:id/open|refresh`, Direct Touch text, native input. Apps and identity stay on **https://nowisee.app**. Compile and install on a **Mac with Xcode** — this project cannot be built on Windows.

Safari still uses the TypeScript website. There is no WKWebView in this app.

## Open and run (Mac)

1. Open `ios/Nowisee.xcodeproj` in Xcode.
2. Signing & Capabilities → Team → your Apple Account (Personal Team is enough; no $99). **Gmail Connect** later needs a paid team: add Associated Domains `applinks:nowisee.app` and `webcredentials:nowisee.app` (bundle `app.nowisee.client`) and set production `NOWISEE_IOS_TEAM_ID` so the host can serve `apple-app-site-association`. Leave those entitlements out until then — they block a free-profile build.
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
| Pan down | `next` — first tick at 8% of overlay height, another 8% to enter fast scrub, then every 4% |
| Pan up | `prev` — same |
| Hold one finger still for **1 second** | `recents` — movement of about 20 points cancels the hold so a swipe still wins |

Once the first vertical tick has fired, further movement is only measured on Y. A second tick needs another 8%; after that, 4% up is another `prev` and 4% down is a `next`, even if the finger also moves sideways. Reversing without lifting the finger walks back through items.

On **input** nodes the overlay hides. VoiceOver uses the native field plus Cancel, Done, and Recent apps. Those buttons stay enabled; taps no-op while Navigator is blocked. Leaving input posts `.screenChanged` onto the overlay; a newer label waits until that overlay is focused, then `setLabel` plus `.announcement` may interrupt. After that, a new text label interrupts the previous utterance (no takeover delay). Connect Gmail opens the system auth sheet (`ASWebAuthenticationSession`); a failed start speaks a retry/back message; cancel leaves the Connect node.

## Local site instead of production

Edit `NowiseeOrigin.url` in [`Nowisee/Config.swift`](Nowisee/Config.swift). Session cookies need HTTPS (`__Host-` + CSRF). A LAN `http://` Vite server will not keep production-style cookies. The `Origin` header must match `NOWISEE_ORIGIN` on the server.

## Website

The TypeScript shell no longer contains a WKWebView bridge. NavPads always mount in the browser.
