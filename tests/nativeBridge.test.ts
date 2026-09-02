/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from "vitest";
import { startShell } from "../src/shell/bootstrap.ts";
import { createAppHost } from "../server/host.ts";
import {
  attachNativeBridge,
  isNativeHostPresent,
} from "../src/shell/nativeBridge.ts";
import type { NavIntent } from "../src/core/types.ts";

type Handler = { messages: unknown[]; postMessage: (m: unknown) => void };

function installNativeHost(): Handler {
  const handler: Handler = {
    messages: [],
    postMessage(m: unknown) {
      handler.messages.push(m);
    },
  };
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: { messageHandlers: { nowisee: handler } },
  });
  return handler;
}

afterEach(() => {
  delete (window as Window & { webkit?: unknown }).webkit;
  delete (window as Window & { __nowiseeNative?: unknown }).__nowiseeNative;
});

describe("nativeBridge", () => {
  it("is absent without webkit.messageHandlers.nowisee", () => {
    expect(isNativeHostPresent()).toBe(false);
  });

  it("posts state and delivers only the four intents", async () => {
    const handler = installNativeHost();
    const intents: NavIntent[] = [];
    let blocked = false;
    const bridge = attachNativeBridge({
      onIntent: (intent) => {
        intents.push(intent);
      },
      getState: () => ({ mode: "text", label: "Hello", blocked }),
    });

    expect(handler.messages).toEqual([{ mode: "text", label: "Hello", blocked: false }]);
    expect(isNativeHostPresent()).toBe(true);

    const api = (window as Window & { __nowiseeNative: { onIntent: (i: string) => unknown } })
      .__nowiseeNative;
    api.onIntent("next");
    api.onIntent("bogus");
    expect(intents).toEqual(["next"]);

    blocked = true;
    api.onIntent("enter");
    expect(handler.messages.at(-1)).toEqual({
      mode: "text",
      label: "Hello",
      blocked: true,
    });

    bridge.detach();
    expect((window as Window & { __nowiseeNative?: unknown }).__nowiseeNative).toBeUndefined();
  });

  it("skips NavPads when the native host is present", async () => {
    installNativeHost();
    window.location.hash = "#/";
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const shell = startShell(mount, {
      config: { rootAppId: "home" },
      rpc: createAppHost({ rootAppId: "home" }),
    });
    await shell.navigator.openLocation({ appId: "home", path: "/" });

    expect(mount.querySelectorAll("button[data-nav-pad]")).toHaveLength(0);
    expect((window as Window & { __nowiseeNative?: { getState: () => unknown } }).__nowiseeNative
      ?.getState()).toMatchObject({ mode: "text" });

    shell.stop();
  });
});
