import { describe, expect, it } from "vitest";
import { createRemoteApp } from "../src/apps/remote.ts";
import { toWireExtras, type AppRpc } from "../src/apps/rpc.ts";
import type { RefreshResult } from "../src/core/types.ts";

const emptyResult: RefreshResult = {
  navigationMap: {},
  warm: [],
  node: { id: "n", label: "N" },
  location: { appId: "demo", path: "/" },
};

describe("toWireExtras", () => {
  it("keeps action and inputText; drops the abort signal", () => {
    expect(
      toWireExtras({
        action: true,
        inputText: "hi",
        signal: new AbortController().signal,
      }),
    ).toEqual({ action: true, inputText: "hi" });
  });

  it("omits action when absent", () => {
    expect(toWireExtras({})).toEqual({});
  });
});

describe("createRemoteApp", () => {
  it("forwards open and refresh to rpc with wire extras only", async () => {
    const calls: unknown[] = [];
    const rpc: AppRpc = {
      async open(appId, path, extras) {
        calls.push({ method: "open", appId, path, extras });
        return emptyResult;
      },
      async refresh(appId, stack, extras) {
        calls.push({ method: "refresh", appId, stack, extras });
        return emptyResult;
      },
    };
    const app = createRemoteApp({ id: "bible", label: "Bible", rpc });
    await app.open("/kjv", { action: true });
    await app.refresh([{ nodeId: "a", label: "A", location: null }], { inputText: "x" });
    expect(calls).toEqual([
      { method: "open", appId: "bible", path: "/kjv", extras: { action: true } },
      {
        method: "refresh",
        appId: "bible",
        stack: [{ nodeId: "a", label: "A", location: null }],
        extras: { inputText: "x" },
      },
    ]);
  });
});
