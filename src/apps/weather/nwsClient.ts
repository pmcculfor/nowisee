import { WeatherClientError, type WeatherClient, type WeatherDay } from "./types.ts";

const USER_AGENT = "Nowisee (https://nowisee.app)";
const ZIPPOPOTAM = "https://api.zippopotam.us/us";
const NWS_POINTS = "https://api.weather.gov/points";

const CARDINAL: Readonly<Record<string, string>> = {
  N: "north",
  NNE: "north-northeast",
  NE: "northeast",
  ENE: "east-northeast",
  E: "east",
  ESE: "east-southeast",
  SE: "southeast",
  SSE: "south-southeast",
  S: "south",
  SSW: "south-southwest",
  SW: "southwest",
  WSW: "west-southwest",
  W: "west",
  WNW: "west-northwest",
  NW: "northwest",
  NNW: "north-northwest",
};

const COMPASS16 = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

export type CreateNwsWeatherClientOptions = {
  readonly fetch?: typeof fetch;
};

type QuantitativeValue = {
  readonly value?: number | null;
  readonly unitCode?: string | null;
};

type HourlyPeriod = {
  readonly startTime?: string;
  readonly temperature?: number | QuantitativeValue;
  readonly temperatureUnit?: string;
  readonly shortForecast?: string;
  readonly windSpeed?: string | QuantitativeValue | null;
  readonly windDirection?: string | number | QuantitativeValue | null;
  readonly windGust?: string | QuantitativeValue | null;
  readonly relativeHumidity?: QuantitativeValue | null;
  readonly heatIndex?: number | QuantitativeValue | null;
  readonly windChill?: number | QuantitativeValue | null;
};

type ForecastPeriod = {
  readonly name?: string;
  readonly startTime?: string;
  readonly isDaytime?: boolean;
  readonly detailedForecast?: string;
};

type PointsResponse = {
  readonly properties?: {
    readonly forecast?: string;
    readonly forecastHourly?: string;
  };
};

type PeriodsResponse = {
  readonly properties?: {
    readonly periods?: readonly unknown[];
  };
};

type ZippopotamResponse = {
  readonly places?: readonly {
    readonly latitude?: string;
    readonly longitude?: string;
  }[];
};

/**
 * National Weather Service + Zippopotam geocode. Lives in this app; the host
 * does not call weather APIs. Tests inject `fetch`.
 */
export function createNwsWeatherClient(options: CreateNwsWeatherClientOptions = {}): WeatherClient {
  const fetchFn = options.fetch ?? fetch;

  return {
    async lookup(zip, signal) {
      const coords = await geocodeZip(fetchFn, zip, signal);
      const points = await getJson<PointsResponse>(
        fetchFn,
        `${NWS_POINTS}/${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`,
        signal,
      );
      const hourlyUrl = points.properties?.forecastHourly;
      const forecastUrl = points.properties?.forecast;
      if (!hourlyUrl || !forecastUrl) {
        throw new WeatherClientError("failed", "NWS points missing forecast URLs");
      }

      const [hourlyBody, forecastBody] = await Promise.all([
        getJson<PeriodsResponse>(fetchFn, hourlyUrl, signal),
        getJson<PeriodsResponse>(fetchFn, forecastUrl, signal),
      ]);

      const hourly = (hourlyBody.properties?.periods ?? []) as HourlyPeriod[];
      const forecast = (forecastBody.properties?.periods ?? []) as ForecastPeriod[];
      if (hourly.length === 0 || forecast.length === 0) {
        throw new WeatherClientError("failed", "NWS returned no periods");
      }

      const currentLabel = formatCurrentLabel(hourly[0]!);
      if (!currentLabel) {
        throw new WeatherClientError("failed", "hourly period missing current fields");
      }

      const today = localDateFromIso(hourly[0]!.startTime);
      return {
        zip,
        currentLabel,
        days: groupForecastDays(forecast, today),
      };
    },
  };
}

export function localDateFromIso(iso: string | undefined): string | null {
  if (!iso) {
    return null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m?.[1] ?? null;
}

export function groupForecastDays(
  periods: readonly ForecastPeriod[],
  today: string | null,
): readonly WeatherDay[] {
  const byDate = new Map<string, { daytime?: ForecastPeriod; night?: ForecastPeriod }>();
  for (const period of periods) {
    const date = localDateFromIso(period.startTime);
    if (!date || (today && date <= today)) {
      continue;
    }
    const slot = byDate.get(date) ?? {};
    if (period.isDaytime) {
      slot.daytime = period;
    } else {
      slot.night = period;
    }
    byDate.set(date, slot);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([date, slot]) => {
      const label = joinPeriodLabels(slot.daytime, slot.night);
      return label ? [{ date, label }] : [];
    });
}

export function formatCurrentLabel(period: HourlyPeriod): string | null {
  const temp = temperatureF(period.temperature, period.temperatureUnit);
  const conditions = spokenConditions(period.shortForecast);
  if (temp === null && !conditions) {
    return null;
  }

  const parts: string[] = [];
  if (temp !== null && conditions) {
    parts.push(`Currently ${temp} degrees, ${conditions}.`);
  } else if (temp !== null) {
    parts.push(`Currently ${temp} degrees.`);
  } else {
    parts.push(`Currently ${conditions}.`);
  }

  const wind = spokenWind(period);
  if (wind) {
    parts.push(wind);
  }

  const humidity = quantitativeNumber(period.relativeHumidity);
  if (humidity !== null) {
    parts.push(`Humidity ${Math.round(humidity)} percent.`);
  }

  const heatIndex = temperatureF(period.heatIndex, undefined);
  if (heatIndex !== null && (temp === null || heatIndex !== temp)) {
    parts.push(`Heat index ${heatIndex} degrees.`);
  }

  const windChill = temperatureF(period.windChill, undefined);
  if (windChill !== null && (temp === null || windChill !== temp)) {
    parts.push(`Wind chill ${windChill} degrees.`);
  }

  return parts.join(" ");
}

function joinPeriodLabels(daytime?: ForecastPeriod, night?: ForecastPeriod): string | null {
  const chunks: string[] = [];
  const day = periodLabel(daytime);
  const nightLabel = periodLabel(night);
  if (day) {
    chunks.push(day);
  }
  if (nightLabel) {
    chunks.push(nightLabel);
  }
  return chunks.length > 0 ? chunks.join(" ") : null;
}

function periodLabel(period: ForecastPeriod | undefined): string | null {
  if (!period) {
    return null;
  }
  const name = period.name?.trim() ?? "";
  const detail = period.detailedForecast?.trim() ?? "";
  if (name && detail) {
    const ended = /[.!?]$/.test(detail) ? detail : `${detail}.`;
    return `${name}. ${ended}`;
  }
  if (detail) {
    return /[.!?]$/.test(detail) ? detail : `${detail}.`;
  }
  if (name) {
    return /[.!?]$/.test(name) ? name : `${name}.`;
  }
  return null;
}

function spokenConditions(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

function spokenWind(period: HourlyPeriod): string | null {
  const range = parseSpeedRangeMph(period.windSpeed);
  if (!range) {
    return null;
  }
  const { min, max } = range;
  if (min === 0 && max === 0) {
    return "Wind calm.";
  }
  const from = spokenDirection(period.windDirection);
  const speed = min === max ? `${min}` : `${min} to ${max}`;
  const gust = parseSpeedRangeMph(period.windGust);
  const gustBit =
    gust && gust.max > max ? `, gusts to ${gust.max}` : "";
  if (from) {
    return `Wind from the ${from} at ${speed} miles per hour${gustBit}.`;
  }
  return `Wind at ${speed} miles per hour${gustBit}.`;
}

function spokenDirection(raw: string | number | QuantitativeValue | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "number") {
    return cardinalFromDegrees(raw);
  }
  if (typeof raw === "object") {
    const deg = quantitativeNumber(raw);
    return deg === null ? null : cardinalFromDegrees(deg);
  }
  const trimmed = raw.trim().toUpperCase();
  if (CARDINAL[trimmed]) {
    return CARDINAL[trimmed]!;
  }
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) {
    return cardinalFromDegrees(asNum);
  }
  return null;
}

function cardinalFromDegrees(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return CARDINAL[COMPASS16[idx]!]!;
}

function temperatureF(
  raw: number | QuantitativeValue | null | undefined,
  unit: string | undefined,
): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return null;
    }
    if ((unit ?? "F").toUpperCase().startsWith("C")) {
      return Math.round((raw * 9) / 5 + 32);
    }
    return Math.round(raw);
  }
  const value = quantitativeNumber(raw);
  if (value === null) {
    return null;
  }
  const code = raw.unitCode ?? "";
  if (code.includes("degC") || code.endsWith(":C")) {
    return Math.round((value * 9) / 5 + 32);
  }
  return Math.round(value);
}

function parseSpeedRangeMph(
  raw: string | QuantitativeValue | null | undefined,
): { min: number; max: number } | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "object") {
    const value = quantitativeNumber(raw);
    if (value === null) {
      return null;
    }
    const mph = unitIsKmH(raw.unitCode) ? value / 1.60934 : value;
    const rounded = Math.round(mph);
    return { min: rounded, max: rounded };
  }
  const m = /(\d+(?:\.\d+)?)(?:\s+to\s+(\d+(?:\.\d+)?))?/i.exec(raw);
  if (!m) {
    return null;
  }
  const first = Number(m[1]);
  const second = m[2] !== undefined ? Number(m[2]) : first;
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }
  let min = first;
  let max = second;
  if (/km/i.test(raw)) {
    min = min / 1.60934;
    max = max / 1.60934;
  }
  return { min: Math.round(min), max: Math.round(max) };
}

function unitIsKmH(unitCode: string | null | undefined): boolean {
  if (!unitCode) {
    return false;
  }
  return /km/i.test(unitCode);
}

function quantitativeNumber(raw: QuantitativeValue | null | undefined): number | null {
  if (!raw || raw.value === null || raw.value === undefined) {
    return null;
  }
  return Number.isFinite(raw.value) ? raw.value : null;
}

async function geocodeZip(
  fetchFn: typeof fetch,
  zip: string,
  signal: AbortSignal | undefined,
): Promise<{ lat: number; lon: number }> {
  const body = await getJson<ZippopotamResponse>(fetchFn, `${ZIPPOPOTAM}/${zip}`, signal);
  const place = body.places?.[0];
  const lat = Number(place?.latitude);
  const lon = Number(place?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new WeatherClientError("not-found", "zip geocode missing coordinates");
  }
  return { lat, lon };
}

async function getJson<T>(
  fetchFn: typeof fetch,
  url: string,
  signal: AbortSignal | undefined,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": USER_AGENT,
      },
      signal,
    });
  } catch (err) {
    if (isAbort(err)) {
      throw err;
    }
    throw new WeatherClientError("failed", err instanceof Error ? err.message : "fetch failed");
  }
  if (res.status === 404) {
    throw new WeatherClientError("not-found", `HTTP 404 ${url}`);
  }
  if (!res.ok) {
    throw new WeatherClientError("failed", `HTTP ${res.status}`);
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    if (isAbort(err)) {
      throw err;
    }
    throw new WeatherClientError("failed", "invalid JSON");
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
