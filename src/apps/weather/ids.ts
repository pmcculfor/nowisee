export const WEATHER_APP_ID = "weather";
export const WEATHER_APP_LABEL = "Weather";

export const NODE = {
  setup: "weather:setup",
  setupEdit: "weather:setup:edit",
  zipSave: "weather:zip-save",
  place: "weather:place",
  placeEdit: "weather:place:edit",
  current: "weather:now",
  notFound: "weather:not-found",
  loadError: "weather:error",
} as const;

export function dayNodeId(date: string): string {
  return `weather:day:${date}`;
}

export function parseDayNodeId(nodeId: string): string | null {
  const m = /^weather:day:(\d{4}-\d{2}-\d{2})$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function placeLabel(zip: string): string {
  return `Change zip code. Current zip is ${zip}.`;
}

/**
 * Accept a 5-digit ZIP, or ZIP+4 (`12345-6789`). Trim. Anything else is invalid.
 */
export function parseZip(raw: string): string | null {
  const trimmed = raw.trim();
  const plusFour = /^(\d{5})-\d{4}$/.exec(trimmed);
  if (plusFour) {
    return plusFour[1]!;
  }
  if (/^\d{5}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}
