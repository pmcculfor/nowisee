import { GMAIL_APP_ID } from "./ids.ts";

/** Catalog `oauth_provider` JSON for Gmail. The host stores this row; Gmail does not import host types. */
export const GMAIL_OAUTH_PROVIDER = {
  appId: GMAIL_APP_ID,
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revokeEndpoint: "https://oauth2.googleapis.com/revoke",
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  extraAuthorizeParams: {
    access_type: "offline",
    prompt: "consent",
  },
} as const;
