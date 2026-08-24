import { encodeRawMessage, extractPlainText, type GmailPayloadPart } from "./mime.ts";
import {
  GmailClientError,
  type GmailClient,
  type InboxMessage,
} from "./types.ts";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const INBOX_PAGE = 20;
const MAX_GET_RETRIES = 3;

export type CreateGmailApiClientOptions = {
  readonly fetch?: typeof fetch;
  /** Injected so 429 tests do not wait. */
  readonly delay?: (ms: number) => Promise<void>;
};

type GmailListResponse = {
  readonly messages?: readonly { readonly id?: string }[];
};

type GmailMessageResponse = {
  readonly id?: string;
  readonly payload?: GmailPayloadPart;
};

type GmailProfileResponse = {
  readonly emailAddress?: string;
};

/**
 * Gmail REST via Node fetch. Token refresh stays in the OAuth broker.
 * GET retries on 429; send does not.
 */
export function createGmailApiClient(options: CreateGmailApiClientOptions = {}): GmailClient {
  const fetchFn = options.fetch ?? fetch;
  const delay = options.delay ?? defaultDelay;

  async function api(
    accessToken: string,
    path: string,
    init: { method?: string; json?: unknown; retry: boolean; signal?: AbortSignal },
  ): Promise<unknown> {
    const method = init.method ?? "GET";
    let lastError: GmailClientError | undefined;
    const attempts = init.retry ? MAX_GET_RETRIES : 1;
    for (let i = 0; i < attempts; i++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      };
      if (init.json !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetchFn(`${GMAIL_API}${path}`, {
        method,
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
        signal: init.signal,
      });
      if (res.status === 401 || res.status === 403) {
        throw new GmailClientError("unauthorized");
      }
      if (res.status === 429) {
        lastError = new GmailClientError("rate-limited");
        if (i < attempts - 1) {
          await delay(200 * 2 ** i);
          continue;
        }
        throw lastError;
      }
      if (!res.ok) {
        throw new GmailClientError("failed", `Gmail HTTP ${res.status}`);
      }
      if (res.status === 204) {
        return undefined;
      }
      const text = await res.text();
      if (!text) {
        return undefined;
      }
      return JSON.parse(text) as unknown;
    }
    throw lastError ?? new GmailClientError("failed");
  }

  return {
    async listInbox(accessToken, opts = {}) {
      const listed = (await api(accessToken, `/messages?labelIds=INBOX&maxResults=${INBOX_PAGE}`, {
        retry: true,
        signal: opts.signal,
      })) as GmailListResponse;
      const ids = (listed.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
      const cachedById = new Map((opts.cached ?? []).map((m) => [m.id, m]));
      const out: InboxMessage[] = [];
      for (const id of ids) {
        const hit = cachedById.get(id);
        if (hit) {
          out.push(hit);
        } else {
          out.push(await getMetadata(accessToken, id, opts.signal));
        }
      }
      return out;
    },

    async getBody(accessToken, messageId, signal) {
      const raw = (await api(accessToken, `/messages/${encodeURIComponent(messageId)}?format=full`, {
        retry: true,
        signal,
      })) as GmailMessageResponse;
      return extractPlainText(raw.payload);
    },

    async getProfile(accessToken, signal) {
      const raw = (await api(accessToken, "/profile", { retry: true, signal })) as GmailProfileResponse;
      const email = raw.emailAddress?.trim() ?? "";
      if (!email) {
        throw new GmailClientError("failed", "Gmail profile missing email");
      }
      return { email };
    },

    async send(accessToken, message, signal) {
      const raw = encodeRawMessage(message);
      await api(accessToken, "/messages/send", {
        method: "POST",
        json: { raw },
        retry: false,
        signal,
      });
    },
  };

  async function getMetadata(
    accessToken: string,
    messageId: string,
    signal?: AbortSignal,
  ): Promise<InboxMessage> {
    const raw = (await api(
      accessToken,
      `/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { retry: true, signal },
    )) as GmailMessageResponse & {
      payload?: { headers?: readonly { name?: string; value?: string }[] };
    };
    const headers = raw.payload?.headers ?? [];
    return {
      id: raw.id ?? messageId,
      from: header(headers, "From"),
      subject: header(headers, "Subject"),
    };
  }
}

function header(
  headers: readonly { name?: string; value?: string }[],
  name: string,
): string {
  const lower = name.toLowerCase();
  return headers.find((h) => (h.name ?? "").toLowerCase() === lower)?.value ?? "";
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
