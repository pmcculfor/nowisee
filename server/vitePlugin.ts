import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import type { KjvData } from "../src/apps/bible/types.ts";
import type { AppRpc } from "../src/apps/rpc.ts";
import { handleAppHttp, isAppApiUrl } from "./http.ts";

export type NowiseeApiPluginOptions = {
  readonly kjv?: KjvData;
};

/**
 * Serves POST /api/apps/:id/open|refresh on the Vite dev and preview servers
 * so the SPA and the app host are same-origin.
 *
 * The Bible JSON is loaded on the first API request so Vitest startup does
 * not pay for KJV when tests inject their own host.
 */
export function nowiseeApiPlugin(options: NowiseeApiPluginOptions = {}): Plugin {
  let rpcPromise: Promise<AppRpc> | undefined;

  function rpc(): Promise<AppRpc> {
    rpcPromise ??= import("./host.ts").then((mod) =>
      mod.createAppHost({ kjv: options.kjv }),
    );
    return rpcPromise;
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
      const raw = req.method === "POST" ? await readBody(req) : "";
      let body: unknown;
      if (raw.length > 0) {
        body = JSON.parse(raw) as unknown;
      }
      const out = await handleAppHttp(await rpc(), {
        method: req.method ?? "GET",
        url,
        body,
      });
      writeJson(res, out.status, out.body);
    } catch {
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

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(json));
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
