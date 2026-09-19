import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parseListen, type ListenAddress } from "../src/apps/appEnv.ts";

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export type ListeningServer = {
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
};

export function parseListenAddress(value: string, name?: string): ListenAddress {
  return parseListen(value, name);
}

/**
 * Bind a loopback HTTP server. `port: 0` asks the kernel for an ephemeral port.
 */
export function listenHttp(
  handler: HttpHandler,
  listen: ListenAddress | "ephemeral",
): Promise<ListeningServer> {
  const address: ListenAddress = listen === "ephemeral" ? { host: "127.0.0.1", port: 0 } : listen;
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((err: unknown) => {
      console.error("http handler failed", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Internal error" }));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address.port, address.host, () => {
      const info = server.address() as AddressInfo;
      resolve({
        origin: `http://${address.host}:${info.port}`,
        port: info.port,
        close: () =>
          new Promise((done, fail) => {
            if (!server.listening) {
              done();
              return;
            }
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
