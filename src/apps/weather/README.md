# Weather (`id: "weather"`)

Weather is an ordinary server `AppModule`. Persistence is `WeatherStore` on this app’s SQLite file (`data/apps/weather.db`) — **one ZIP per user**, never the forecast. Every store method takes `userId` (`ctx.userId`); the host does not inject the store. Live conditions come from this app’s NWS client (`nwsClient.ts`). The host does not call weather.gov. See [`docs/STORAGE.md`](../../../docs/STORAGE.md).

Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`store.ts`](store.ts), [`nwsClient.ts`](nwsClient.ts). Tests: [`tests/weather.test.ts`](../../../tests/weather.test.ts) (in-memory SQLite, fake client; no live NWS in CI).

## Signed out

When `ctx.userId` is null, the tip is **Sign in to use Weather.** `enter` is an `app` edge to `ctx.accountAppId`. `back` goes to Home. No ZIP is read or written. The weather client is not called.

## Signed in, no ZIP

Open `/` lands on **Enter your zip code.** `enter` replaces onto an empty input. **Done** (`enter`) commits with `passInputText` and `action: true` after a successful lookup, then lands on current. **Cancel** returns to the prompt without saving. Empty or non-5-digit text does not call NWS and does not write a row.

## Signed in, has ZIP

Open `/` lands on **current** (not the ZIP-change node). The sibling list (no wrap) is:

1. **Change zip code. Current zip is {zip}.** — `enter` replaces onto the ZIP input, prefilled with the stored ZIP.
2. Current conditions (first hourly period).
3. One node per later calendar day from the 12-hour forecast (`name` + `detailedForecast`, daytime then night when both exist).

`back` on every list row is an `app` edge to Home. **Cancel** on the ZIP input returns to the change-zip node without writing. **Done** saves only after a successful lookup.

Weather is looked up on every `open` / `refresh` that shows the list. It is never stored.

## Current and days

Current is spoken from the first `/forecast/hourly` period: conditions, temperature in Fahrenheit, wind (gusts if present), humidity, and heat index or wind chill only when NWS sends a distinct value. There is no fallback to a 12-hour period if hourly fails.

Day nodes are not rebuilt from structured fields. Both hourly and the 12-hour forecast are required; either failing is **Could not load weather.** (ZIP kept) or **That zip code was not found.** (ZIP not overwritten). Status tips use `location: null` except the load-error-with-saved-zip path, which stays at `/`. `enter` on load-error with a saved ZIP replaces onto current so the next refresh retries.

Resolve the ZIP with `user_id` in the query. A ZIP the user does not own is treated as no ZIP.

## Non-goals

Alerts, an hourly list, multiple saved places, international postal codes, unit settings, radar, or caching forecasts.
