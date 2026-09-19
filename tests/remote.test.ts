import { describe, expect, it } from "vitest";
import { createRemoteApp } from "../src/shell/remote.ts";
import { toWireExtras, type AppRpc } from "../src/shell/rpc.ts";
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
        action: { triggerId: "n1" },
        inputText: "hi",
        signal: new AbortController().signal,
      }),
    ).toEqual({ action: { triggerId: "n1" }, inputText: "hi" });
  });

  it("omits action when absent", () => {
    expect(toWireExtras({})).toEqual({});
  });

  it("keeps parkedAppIds", () => {
    expect(toWireExtras({ parkedAppIds: ["notes", "home"] })).toEqual({
      parkedAppIds: ["notes", "home"],
    });
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
      async refresh(appId, nodeId, extras) {
        calls.push({ method: "refresh", appId, nodeId, extras });
        return emptyResult;
      },
    };
    const app = createRemoteApp({ id: "bible", label: "Bible", rpc });
    await app.open("/", { action: { triggerId: "root" } });
    await app.refresh("a", { inputText: "x" });
    expect(calls).toEqual([
      { method: "open", appId: "bible", path: "/", extras: { action: { triggerId: "root" } } },
      {
        method: "refresh",
        appId: "bible",
        nodeId: "a",
        extras: { inputText: "x" },
      },
    ]);
  });
});
