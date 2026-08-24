import type { OAuthProviderConfig } from "../../../server/oauth/providers.ts";
import { GMAIL_APP_ID } from "./ids.ts";

/** Host provider row — Google OAuth endpoints, not Gmail message URLs. */
export const GMAIL_OAUTH_PROVIDER: OAuthProviderConfig = {
  appId: GMAIL_APP_ID,
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revokeEndpoint: "https://oauth2.googleapis.com/revoke",
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  extraAuthorizeParams: {
    access_type: "offline",
    prompt: "consent",
  },
};

/** Grants for the running host (`npm start` / Vite). Tests leave lists empty. */
export function productionGmailGrants(): {
  readonly lockboxAppIds: readonly string[];
  readonly oauthAppIds: readonly string[];
  readonly oauthProviders: readonly OAuthProviderConfig[];
} {
  return {
    lockboxAppIds: [GMAIL_APP_ID],
    oauthAppIds: [GMAIL_APP_ID],
    oauthProviders: [GMAIL_OAUTH_PROVIDER],
  };
}
