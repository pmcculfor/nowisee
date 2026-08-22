import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { createNowiseeHost, type NowiseeHost } from "./host.ts";
import { SCRYPT_PRODUCTION } from "./identity/hash.ts";
import { handleSessionHttp, isAppApiUrl } from "./http.ts";
import { BodyTooLargeError, readLimitedBody } from "./readBody.ts";

export type NowiseeApiPluginOptions = {
  readonly dbPath?: string;
};

/**
 * Serves POST /api/apps/:id/open|refresh on the Vite dev and preview servers
 * so the SPA and the app host are same-origin.
 */
export function nowiseeApiPlugin(options: NowiseeApiPluginOptions = {}): Plugin {
  let host: NowiseeHost | undefined;

  function getHost(): NowiseeHost {
    host ??= createNowiseeHost({
      db: options.dbPath ?? process.env.NOWISEE_DB ?? "data/nowisee.db",
      scrypt: SCRYPT_PRODUCTION,
      configuredOrigin: process.env.NOWISEE_ORIGIN,
    });
    return host;
  }

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void handle(req, res, next);
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ): Promise<void> {
    const url = req.url ?? "/";
    if (!isAppApiUrl(url)) {
      next();
      return;
    }
    try {
      const raw = req.method === "POST" ? await readLimitedBody(req) : "";
      let body: unknown;
      if (raw.length > 0) {
        body = JSON.parse(raw) as unknown;
      }
      const out = await handleSessionHttp(getHost(), {
        method: req.method ?? "GET",
        url,
        headers: req.headers,
        body,
        encrypted: Boolean((req.socket as { encrypted?: boolean }).encrypted),
      });
      writeJson(res, out.status, out.body, out.headers);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        writeJson(res, 413, { error: "Request body too large" });
        return;
      }
      writeJson(res, 400, { error: "Invalid JSON" });
    }
  }

  return {
    name: "nowisee-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  const headers = extraHeaders ?? {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  if (!res.getHeader("Content-Type")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.setHeader("Content-Length", Buffer.byteLength(json));
  res.end(json);
}
