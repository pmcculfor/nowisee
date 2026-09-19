export type ListenAddress = {
  readonly host: string;
  readonly port: number;
};

export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/** `127.0.0.1:3114` or `localhost:3114`. */
export function parseListen(value: string, name = "NOWISEE_LISTEN"): ListenAddress {
  const trimmed = value.trim();
  const colon = trimmed.lastIndexOf(":");
  if (colon <= 0 || colon === trimmed.length - 1) {
    throw new Error(`${name} must be host:port`);
  }
  const host = trimmed.slice(0, colon);
  const port = Number(trimmed.slice(colon + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be host:port`);
  }
  return { host, port };
}

export function listenOrigin(listen: ListenAddress): string {
  return `http://${listen.host}:${listen.port}`;
}
