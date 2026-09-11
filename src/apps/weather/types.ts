/**
 * One forecast day. Date is local YYYY-MM-DD from the NWS period start.
 */
export type WeatherDay = {
  readonly date: string;
  readonly label: string;
};

export type WeatherSnapshot = {
  readonly zip: string;
  readonly currentLabel: string;
  readonly days: readonly WeatherDay[];
};

/**
 * Persistence behind Weather. Core never sees this.
 * The host does not inject this store; Weather opens its own SQLite file.
 * Every method takes `userId` (`ctx.userId`) and includes it in the query.
 */
export interface WeatherStore {
  getZip(userId: string): Promise<string | null>;
  setZip(userId: string, zip: string): Promise<void>;
}

export type WeatherClientErrorCode = "not-found" | "failed";

export class WeatherClientError extends Error {
  readonly code: WeatherClientErrorCode;
  constructor(code: WeatherClientErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WeatherClientError";
    this.code = code;
  }
}

export interface WeatherClient {
  lookup(zip: string, signal?: AbortSignal): Promise<WeatherSnapshot>;
}
