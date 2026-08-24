export type TokenResponse = {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
  readonly [key: string]: unknown;
};

export type NormalizedTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  extra?: Record<string, string>;
  needsReconnect?: boolean;
};

export type ProviderEventRequest = {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type ProviderEventResponse = {
  readonly status: number;
  readonly body?: string;
};

export type OAuthProviderConfig = {
  readonly appId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revokeEndpoint?: string;
  readonly scopes: readonly string[];
  readonly extraAuthorizeParams?: Readonly<Record<string, string>>;
  readonly extraTokenParams?: Readonly<Record<string, string>>;
  readonly finalizeTokens?: (raw: TokenResponse) => Promise<NormalizedTokens>;
  readonly refreshTokens?: (current: NormalizedTokens) => Promise<NormalizedTokens>;
  readonly onProviderEvent?: (req: ProviderEventRequest) => Promise<ProviderEventResponse>;
};

export function assertSafeEndpoint(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid OAuth endpoint URL: ${url}`);
  }
  if (parsed.protocol === "https:") {
    return;
  }
  if (
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
  ) {
    return;
  }
  throw new Error(`OAuth endpoint must be https (or http localhost): ${url}`);
}

export function registerProviders(
  configs: readonly OAuthProviderConfig[],
): ReadonlyMap<string, OAuthProviderConfig> {
  const map = new Map<string, OAuthProviderConfig>();
  for (const config of configs) {
    assertSafeEndpoint(config.authorizationEndpoint);
    assertSafeEndpoint(config.tokenEndpoint);
    if (config.revokeEndpoint) {
      assertSafeEndpoint(config.revokeEndpoint);
    }
    if (map.has(config.appId)) {
      throw new Error(`Duplicate OAuth provider for app ${config.appId}`);
    }
    map.set(config.appId, config);
  }
  return map;
}
