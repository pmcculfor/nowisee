import { afterEach, describe, expect, it } from "vitest";
import { edgeApp } from "../src/app-kit/index.ts";
import { createWeatherApp, type WeatherApp } from "../src/apps/weather/index.ts";
import {
  NODE,
  WEATHER_APP_ID,
  dayNodeId,
  parseZip,
  placeLabel,
} from "../src/apps/weather/ids.ts";
import {
  createNwsWeatherClient,
  formatCurrentLabel,
  groupForecastDays,
} from "../src/apps/weather/nwsClient.ts";
import {
  createSqliteWeatherStore,
  openWeatherDatabase,
  startWeatherApp,
} from "../src/apps/weather/store.ts";
import {
  WeatherClientError,
  type WeatherClient,
  type WeatherSnapshot,
  type WeatherStore,
} from "../src/apps/weather/types.ts";
import type { AppServerContext } from "../src/core/types.ts";

const USER = "user-1";
const OTHER = "user-2";
const ZIP = "90210";

const SAMPLE: WeatherSnapshot = {
  zip: ZIP,
  currentLabel:
    "Currently 72 degrees, partly cloudy. Wind from the west at 8 miles per hour. Humidity 45 percent.",
  days: [
    {
      date: "2026-09-12",
      label: "Saturday. Sunny, with a high near 78. West wind 5 to 10 mph.",
    },
    {
      date: "2026-09-13",
      label: "Sunday. Partly cloudy, with a high near 80.",
    },
  ],
};

function signedIn(userId: string = USER): AppServerContext {
  return { userId, sessionId: "session-1", accountAppId: "account" };
}

function signedOutCtx(): AppServerContext {
  return { userId: null, sessionId: "session-1", accountAppId: "account" };
}

function fakeClient(options: {
  readonly snapshot?: WeatherSnapshot;
  readonly byZip?: Readonly<Record<string, WeatherSnapshot>>;
  readonly error?: WeatherClientError;
  readonly errorByZip?: Readonly<Record<string, WeatherClientError>>;
} = {}): WeatherClient & { lookups: string[] } {
  const lookups: string[] = [];
  const client: WeatherClient & { lookups: string[] } = {
    lookups,
    async lookup(zip) {
      lookups.push(zip);
      const mappedError = options.errorByZip?.[zip];
      if (mappedError) {
        throw mappedError;
      }
      if (options.error) {
        throw options.error;
      }
      const mapped = options.byZip?.[zip];
      if (mapped) {
        return mapped;
      }
      return options.snapshot ?? { ...SAMPLE, zip };
    },
  };
  return client;
}

const opened: WeatherApp[] = [];

afterEach(() => {
  for (const app of opened) {
    app.close();
  }
  opened.length = 0;
});

function harness(
  options: {
    readonly zipByUser?: Readonly<Record<string, string>>;
    readonly client?: WeatherClient & { lookups: string[] };
  } = {},
): {
  app: WeatherApp;
  store: WeatherStore;
  client: WeatherClient & { lookups: string[] };
} {
  const db = openWeatherDatabase(":memory:");
  const store = createSqliteWeatherStore(db);
  for (const [userId, zip] of Object.entries(options.zipByUser ?? {})) {
    db.run(
      "INSERT INTO settings (user_id, zip, updated_at) VALUES (?, ?, ?)",
      userId,
      zip,
      "2026-09-11T00:00:00.000Z",
    );
  }
  const client = options.client ?? fakeClient();
  const app = createWeatherApp({
    rootAppId: "home",
    store,
    client,
    close: () => db.close(),
  });
  opened.push(app);
  return { app, store, client };
}

describe("Weather app graph", () => {
  it("signed out is a sign-in node and does not read zip or look up weather", async () => {
    const { app, store, client } = harness({ zipByUser: { [USER]: ZIP } });
    const result = await app.open("/", {}, signedOutCtx());
    expect(result.node.label).toBe("Sign in to use Weather.");
    expect(result.navigationMap[result.node.id]?.enter).toEqual(
      edgeApp({ appId: "account", path: "/" }),
    );
    expect(result.navigationMap[result.node.id]?.back).toEqual(
      edgeApp({ appId: "home", path: "/app/weather" }),
    );
    expect(client.lookups).toEqual([]);
    expect(await store.getZip(USER)).toBe(ZIP);

    await app.refresh(
      [{ nodeId: NODE.zipSave, label: "Saving…", location: null }],
      { action: true, inputText: "10001" },
      signedOutCtx(),
    );
    expect(await store.getZip(USER)).toBe(ZIP);
    expect(client.lookups).toEqual([]);
  });

  it("missing ctx is treated as signed out", async () => {
    const { app, client } = harness();
    const result = await app.open("/");
    expect(result.node.label).toBe("Sign in to use Weather.");
    expect(client.lookups).toEqual([]);
  });

  it("open with no zip tips Enter your zip code", async () => {
    const { app, client } = harness();
    const result = await app.open("/", {}, signedIn());
    expect(result.node.id).toBe(NODE.setup);
    expect(result.node.label).toBe("Enter your zip code.");
    expect(result.location).toEqual({ appId: WEATHER_APP_ID, path: "/setup" });
    expect(result.navigationMap[NODE.setup]?.back).toEqual(
      edgeApp({ appId: "home", path: "/app/weather" }),
    );
    expect(result.navigationMap[NODE.setup]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.setupEdit,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[NODE.setupEdit]?.enter).toMatchObject({
      kind: "node",
      toNodeId: NODE.zipSave,
      stackBehavior: "replace",
      passInputText: true,
      action: true,
    });
    expect(client.lookups).toEqual([]);
  });

  it("Done with a 5-digit zip saves, looks up once, and tips current", async () => {
    const { app, store, client } = harness();
    const result = await app.refresh(
      [{ nodeId: NODE.zipSave, label: "Saving…", location: null }],
      { action: true, inputText: ZIP },
      signedIn(),
    );
    expect(await store.getZip(USER)).toBe(ZIP);
    expect(client.lookups).toEqual([ZIP]);
    expect(result.node.id).toBe(NODE.current);
    expect(result.node.label).toBe(SAMPLE.currentLabel);
    expect(result.location).toEqual({ appId: WEATHER_APP_ID, path: "/now" });
  });

  it("Done with ZIP+4 stores the first five digits", async () => {
    const { app, store, client } = harness();
    await app.refresh(
      [{ nodeId: NODE.zipSave, label: "Saving…", location: null }],
      { action: true, inputText: "90210-1234" },
      signedIn(),
    );
    expect(await store.getZip(USER)).toBe(ZIP);
    expect(client.lookups).toEqual([ZIP]);
  });

  it("open with a zip lands on current; prev is the change-zip node", async () => {
    const { app, client } = harness({ zipByUser: { [USER]: ZIP } });
    const result = await app.open("/", {}, signedIn());
    expect(result.node.id).toBe(NODE.current);
    expect(result.node.label).toBe(SAMPLE.currentLabel);
    expect(result.navigationMap[NODE.current]?.prev).toMatchObject({
      kind: "node",
      toNodeId: NODE.place,
      stackBehavior: "replace",
    });
    expect(result.warm.find((n) => n.id === NODE.place)?.label).toBe(placeLabel(ZIP));
    expect(result.navigationMap[NODE.place]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.placeEdit,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[NODE.placeEdit]?.back).toEqual({
      kind: "node",
      toNodeId: NODE.place,
      stackBehavior: "replace",
    });
    expect(client.lookups).toEqual([ZIP]);
  });

  it("sibling list is header, current, days; no wrap; every row backs to Home", async () => {
    const { app } = harness({ zipByUser: { [USER]: ZIP } });
    const result = await app.open("/", {}, signedIn());
    const saturday = dayNodeId("2026-09-12");
    const sunday = dayNodeId("2026-09-13");
    expect(result.navigationMap[NODE.place]?.prev).toBeUndefined();
    expect(result.navigationMap[NODE.place]?.next).toMatchObject({ toNodeId: NODE.current });
    expect(result.navigationMap[NODE.current]?.next).toMatchObject({ toNodeId: saturday });
    expect(result.navigationMap[saturday]?.next).toMatchObject({ toNodeId: sunday });
    expect(result.navigationMap[sunday]?.next).toBeUndefined();
    for (const id of [NODE.place, NODE.current, saturday, sunday]) {
      expect(result.navigationMap[id]?.back).toEqual(
        edgeApp({ appId: "home", path: "/app/weather" }),
      );
    }
  });

  it("looks up weather on every open and refresh; zip row is unchanged", async () => {
    const { app, store, client } = harness({ zipByUser: { [USER]: ZIP } });
    await app.open("/", {}, signedIn());
    await app.refresh([{ nodeId: NODE.current, label: SAMPLE.currentLabel, location: null }], {}, signedIn());
    await app.open("/place", {}, signedIn());
    expect(client.lookups).toEqual([ZIP, ZIP, ZIP]);
    expect(await store.getZip(USER)).toBe(ZIP);
  });

  it("invalid zip does not look up or save", async () => {
    const { app, store, client } = harness();
    const result = await app.refresh(
      [{ nodeId: NODE.zipSave, label: "Saving…", location: null }],
      { action: true, inputText: "abc" },
      signedIn(),
    );
    expect(result.node.id).toBe(NODE.notFound);
    expect(result.node.label).toBe("That zip code was not found.");
    expect(result.location).toBeNull();
    expect(result.navigationMap[NODE.notFound]?.enter).toMatchObject({
      toNodeId: NODE.setupEdit,
    });
    expect(result.navigationMap[NODE.notFound]?.back).toMatchObject({
      toNodeId: NODE.setup,
    });
    expect(client.lookups).toEqual([]);
    expect(await store.getZip(USER)).toBeNull();
  });

  it("client not-found on change-zip does not overwrite the saved zip", async () => {
    const client = fakeClient({
      errorByZip: { "00000": new WeatherClientError("not-found") },
    });
    const { app, store } = harness({ zipByUser: { [USER]: ZIP }, client });
    const result = await app.refresh(
      [{ nodeId: NODE.zipSave, label: "Saving…", location: null }],
      { action: true, inputText: "00000" },
      signedIn(),
    );
    expect(result.node.id).toBe(NODE.notFound);
    expect(result.navigationMap[NODE.notFound]?.back).toMatchObject({
      toNodeId: NODE.place,
    });
    expect(await store.getZip(USER)).toBe(ZIP);
  });

  it("client failed with a saved zip is a load-error; zip is kept", async () => {
    const { app, store } = harness({
      zipByUser: { [USER]: ZIP },
      client: fakeClient({ error: new WeatherClientError("failed") }),
    });
    const result = await app.open("/", {}, signedIn());
    expect(result.node.id).toBe(NODE.loadError);
    expect(result.node.label).toBe("Could not load weather.");
    expect(result.navigationMap[NODE.loadError]?.enter).toMatchObject({
      toNodeId: NODE.current,
    });
    expect(result.navigationMap[NODE.loadError]?.back).toEqual(
      edgeApp({ appId: "home", path: "/app/weather" }),
    );
    expect(await store.getZip(USER)).toBe(ZIP);
  });

  it("lists only the signed-in user's zip; a forged day id repairs to current", async () => {
    const { app } = harness({
      zipByUser: { [USER]: ZIP, [OTHER]: "10001" },
      client: fakeClient({
        byZip: {
          [ZIP]: SAMPLE,
          "10001": {
            zip: "10001",
            currentLabel: "Currently 40 degrees, rain.",
            days: [{ date: "2026-09-12", label: "Saturday. Rain." }],
          },
        },
      }),
    });
    const mine = await app.open("/", {}, signedIn(USER));
    expect(mine.node.label).toBe(SAMPLE.currentLabel);
    expect(mine.warm.some((n) => n.label.includes("10001"))).toBe(false);

    const other = await app.open("/", {}, signedIn(OTHER));
    expect(other.warm.find((n) => n.id === NODE.place)?.label).toBe(placeLabel("10001"));

    const forged = await app.refresh(
      [{ nodeId: dayNodeId("1999-01-01"), label: "Gone", location: null }],
      {},
      signedIn(USER),
    );
    expect(forged.node.id).toBe(NODE.current);
  });

  it("does not save without extras.action", async () => {
    const { app, store, client } = harness({ zipByUser: { [USER]: ZIP } });
    await app.refresh(
      [{ nodeId: NODE.placeEdit, label: ZIP, location: null }],
      { inputText: "10001" },
      signedIn(),
    );
    expect(await store.getZip(USER)).toBe(ZIP);
    expect(client.lookups).toEqual([ZIP]);
  });

  it("does not save when action is set but typed text is missing", async () => {
    const { app, store } = harness({ zipByUser: { [USER]: ZIP } });
    const result = await app.refresh(
      [{ nodeId: NODE.zipSave, label: "Saving…", location: null }],
      { action: true },
      signedIn(),
    );
    expect(await store.getZip(USER)).toBe(ZIP);
    expect(result.node.id).toBe(NODE.placeEdit);
  });
});

describe("Weather zip parsing", () => {
  it("accepts 5 digits and ZIP+4", () => {
    expect(parseZip("90210")).toBe("90210");
    expect(parseZip(" 12345-6789 ")).toBe("12345");
    expect(parseZip("9021")).toBeNull();
    expect(parseZip("abcde")).toBeNull();
  });
});

describe("NWS spoken labels", () => {
  it("formats current from hourly fields and omits null extras", () => {
    expect(
      formatCurrentLabel({
        temperature: 72,
        temperatureUnit: "F",
        shortForecast: "Partly Cloudy",
        windSpeed: "8 mph",
        windDirection: "W",
        relativeHumidity: { value: 45, unitCode: "wmoUnit:percent" },
      }),
    ).toBe(
      "Currently 72 degrees, partly cloudy. Wind from the west at 8 miles per hour. Humidity 45 percent.",
    );
    expect(
      formatCurrentLabel({
        temperature: 98,
        temperatureUnit: "F",
        shortForecast: "Hot",
        heatIndex: 98,
      }),
    ).toBe("Currently 98 degrees, hot.");
    expect(
      formatCurrentLabel({
        temperature: 90,
        temperatureUnit: "F",
        shortForecast: "Hot",
        heatIndex: 102,
        windSpeed: "5 to 10 mph",
        windDirection: "NW",
        windGust: "20 mph",
      }),
    ).toBe(
      "Currently 90 degrees, hot. Wind from the northwest at 5 to 10 miles per hour, gusts to 20. Heat index 102 degrees.",
    );
  });

  it("groups later calendar days and concatenates day and night", () => {
    const days = groupForecastDays(
      [
        {
          name: "This Afternoon",
          startTime: "2026-09-11T13:00:00-04:00",
          isDaytime: true,
          detailedForecast: "Sunny, with a high near 70.",
        },
        {
          name: "Tonight",
          startTime: "2026-09-11T18:00:00-04:00",
          isDaytime: false,
          detailedForecast: "Clear, with a low around 50.",
        },
        {
          name: "Saturday",
          startTime: "2026-09-12T06:00:00-04:00",
          isDaytime: true,
          detailedForecast: "Sunny, with a high near 78.",
        },
        {
          name: "Saturday Night",
          startTime: "2026-09-12T18:00:00-04:00",
          isDaytime: false,
          detailedForecast: "Mostly clear, with a low around 55.",
        },
      ],
      "2026-09-11",
    );
    expect(days).toEqual([
      {
        date: "2026-09-12",
        label:
          "Saturday. Sunny, with a high near 78. Saturday Night. Mostly clear, with a low around 55.",
      },
    ]);
  });
});

describe("NWS weather client", () => {
  it("geocodes, fetches hourly and forecast, and maps a snapshot", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://api.zippopotam.us/us/90210") {
        return json({ places: [{ latitude: "34.0901", longitude: "-118.4065" }] });
      }
      if (url === "https://api.weather.gov/points/34.0901,-118.4065") {
        return json({
          properties: {
            forecastHourly: "https://api.weather.gov/gridpoints/LOX/1,1/forecast/hourly",
            forecast: "https://api.weather.gov/gridpoints/LOX/1,1/forecast",
          },
        });
      }
      if (url.endsWith("/forecast/hourly")) {
        return json({
          properties: {
            periods: [
              {
                startTime: "2026-09-11T10:00:00-07:00",
                temperature: 72,
                temperatureUnit: "F",
                shortForecast: "Partly Cloudy",
                windSpeed: "8 mph",
                windDirection: "W",
                relativeHumidity: { value: 45, unitCode: "wmoUnit:percent" },
              },
            ],
          },
        });
      }
      if (url.endsWith("/forecast")) {
        return json({
          properties: {
            periods: [
              {
                name: "Saturday",
                startTime: "2026-09-12T06:00:00-07:00",
                isDaytime: true,
                detailedForecast: "Sunny, with a high near 78.",
              },
            ],
          },
        });
      }
      return new Response("", { status: 404 });
    };
    const snapshot = await createNwsWeatherClient({ fetch: fetchFn }).lookup("90210");
    expect(snapshot.currentLabel).toContain("Currently 72 degrees");
    expect(snapshot.days[0]?.date).toBe("2026-09-12");
  });

  it("does not substitute 12-hour current when hourly fails", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("zippopotam")) {
        return json({ places: [{ latitude: "34.0901", longitude: "-118.4065" }] });
      }
      if (url.includes("/points/")) {
        return json({
          properties: {
            forecastHourly: "https://api.weather.gov/gridpoints/LOX/1,1/forecast/hourly",
            forecast: "https://api.weather.gov/gridpoints/LOX/1,1/forecast",
          },
        });
      }
      if (url.endsWith("/forecast/hourly")) {
        return new Response("", { status: 500 });
      }
      if (url.endsWith("/forecast")) {
        return json({
          properties: {
            periods: [
              {
                name: "This Afternoon",
                startTime: "2026-09-11T13:00:00-07:00",
                isDaytime: true,
                detailedForecast: "Sunny.",
              },
            ],
          },
        });
      }
      return new Response("", { status: 404 });
    };
    await expect(createNwsWeatherClient({ fetch: fetchFn }).lookup("90210")).rejects.toMatchObject({
      code: "failed",
    });
  });

  it("maps zippopotam 404 to not-found", async () => {
    const fetchFn: typeof fetch = async () => new Response("", { status: 404 });
    await expect(createNwsWeatherClient({ fetch: fetchFn }).lookup("00000")).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("Weather sqlite store", () => {
  it("scopes zip rows by user_id", async () => {
    const db = openWeatherDatabase(":memory:");
    const store = createSqliteWeatherStore(db);
    await store.setZip(USER, ZIP);
    expect(await store.getZip(OTHER)).toBeNull();
    expect(await store.getZip(USER)).toBe(ZIP);
    db.close();
  });

  it("startWeatherApp signed-out does not fetch NWS", async () => {
    let fetches = 0;
    const fetchFn: typeof fetch = async () => {
      fetches += 1;
      return new Response("", { status: 500 });
    };
    const app = startWeatherApp({ rootAppId: "home", dbPath: ":memory:", fetch: fetchFn });
    try {
      const result = await app.open("/", {}, signedOutCtx());
      expect(result.node.label).toBe("Sign in to use Weather.");
      expect(fetches).toBe(0);
    } finally {
      app.close();
    }
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
