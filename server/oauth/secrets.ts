export type OAuthClientSecrets = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type OAuthSecrets = {
  forApp(appId: string): OAuthClientSecrets | undefined;
};

export function envOAuthSecrets(env: NodeJS.ProcessEnv = process.env): OAuthSecrets {
  return {
    forApp(appId) {
      const key = appId.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toUpperCase();
      const clientId = env[`NOWISEE_OAUTH_${key}_CLIENT_ID`];
      const clientSecret = env[`NOWISEE_OAUTH_${key}_CLIENT_SECRET`];
      if (!clientId || !clientSecret) {
        return undefined;
      }
      return { clientId, clientSecret };
    },
  };
}

export function mapOAuthSecrets(
  map: Readonly<Record<string, OAuthClientSecrets>>,
): OAuthSecrets {
  return {
    forApp(appId) {
      return map[appId];
    },
  };
}
