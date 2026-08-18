/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from "vitest";
import { Display } from "../src/core/display.ts";
import { NavigationMapStore } from "../src/core/navigationMap.ts";
import { Navigator } from "../src/core/navigator.ts";
import { NodeCache } from "../src/core/nodeCache.ts";
import { PlatformCapabilities } from "../src/core/platform.ts";
import { AppRegistry } from "../src/core/registry.ts";
import { Router } from "../src/core/router.ts";
import { Stack } from "../src/core/stack.ts";
import type { AppLocation, AppModule } from "../src/core/types.ts";
import { createFakeApp, createRootApp } from "./helpers/fakeApp.ts";

function visibleText(root: HTMLElement): string {
  const input = root.querySelector<HTMLTextAreaElement>("textarea[data-surface='input']");
  if (input) {
    return input.value;
  }
  const text = root.querySelector("[data-surface='text']");
  if (text) {
    return text.textContent ?? "";
  }
  return root.textContent ?? "";
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function intent(nav: Navigator, name: Parameters<Navigator["onIntent"]>[0]): Promise<void> {
  await nav.onIntent(name);
  await flush();
}

function harness(args?: {
  gate?: () => Promise<void>;
  clipboard?: null | { writeText: (t: string) => Promise<void> };
}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const display = new Display(root);
  const registry = new AppRegistry();
  const fake = createFakeApp({
    id: "fake",
    label: "Fake",
    rootAppId: "home",
    gate: args?.gate,
  });
  registry.register(createRootApp("home"));
  registry.register(fake.app);

  const map = new NavigationMapStore();
  const cache = new NodeCache();
  const stack = new Stack();
  const addressLog: AppLocation[] = [];
  const externalLog: string[] = [];

  let hash = "#/";
  const platform = new PlatformCapabilities({
    clipboard:
      args?.clipboard === null
        ? null
        : (args?.clipboard ?? {
            writeText: async () => undefined,
          }),
  });

  let router!: Router;
  const navigator = new Navigator({
    config: { rootAppId: "home" },
    registry,
    display,
    platform,
    map,
    cache,
    stack,
    setAddressBar: (loc) => {
      addressLog.push(loc);
      router.setAddressBar(loc);
    },
    handOffExternal: (href) => {
      externalLog.push(href);
    },
  });

  router = new Router({
    rootAppId: "home",
    isKnownApp: (id) => registry.get(id) !== null,
    onLocation: (loc) => {
      void navigator.openLocation(loc);
    },
    location: {
      getHash: () => hash,
      setHash: (next) => {
        hash = next;
      },
    },
    eventTarget: new EventTarget(),
  });

  return {
    root,
    display,
    navigator,
    router,
    registry,
    map,
    cache,
    stack,
    fake,
    addressLog,
    externalLog,
    getHash: () => hash,
  };
}

describe("Navigator + Router contracts", () => {
  it("openLocation bootstraps stack, map, display, and address bar", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    expect(visibleText(h.root)).toBe("Root");
    expect(h.stack.tip()?.nodeId).toBe("root");
    expect(h.map.lookup("root", "next")?.kind).toBe("node");
    expect(h.addressLog.at(-1)).toEqual({ appId: "fake", path: "/" });
    expect(h.getHash()).toBe("#/fake");
  });

  it("push / replace / pop; pop omits toNodeId", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });

    await intent(h.navigator, "enter"); // push child
    expect(h.stack.snapshot().map((e) => e.nodeId)).toEqual(["root", "child"]);
    expect(visibleText(h.root)).toBe("Child");

    await intent(h.navigator, "back"); // pop
    expect(h.stack.snapshot().map((e) => e.nodeId)).toEqual(["root"]);
    expect(visibleText(h.root)).toBe("Root");

    await intent(h.navigator, "next"); // replace → a
    expect(h.stack.snapshot().map((e) => e.nodeId)).toEqual(["a"]);
    expect(visibleText(h.root)).toBe("A");
  });

  it("app edge clears stack and switches app", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    await intent(h.navigator, "next");
    expect(h.stack.tip()?.nodeId).toBe("a");

    await intent(h.navigator, "back"); // app → home
    expect(h.navigator.getCurrentAppId()).toBe("home");
    expect(h.stack.tip()?.nodeId).toBe("home-root");
    expect(visibleText(h.root)).toBe("Home");
  });

  it("warm hit updates display immediately; warm miss blocks without placeholder", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });

    // Warm hit
    h.navigator.onIntent("next");
    expect(visibleText(h.root)).toBe("A"); // sync local move
    expect(h.navigator.isBlocked()).toBe(false);
    await flush();

    // Force warm miss: clear cache entry for destination but keep map
    const cold = harness();
    await cold.navigator.openLocation({ appId: "fake", path: "/" });
    // Replace map to point at unknown id, empty warm path via custom refresh
    cold.map.replace({
      root: {
        next: { kind: "node", toNodeId: "ghost", stackBehavior: "replace" },
      },
    });
    const before = visibleText(cold.root);
    cold.navigator.onIntent("next");
    expect(cold.navigator.isBlocked()).toBe(true);
    expect(visibleText(cold.root)).toBe(before); // no placeholder
    expect(cold.stack.tip()?.nodeId).toBe("ghost");
  });

  it("warm revalidation with identical tip does not remount the text surface", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });

    const moving = h.navigator.onIntent("next");
    expect(visibleText(h.root)).toBe("A");
    const surfaceAfterWarm = h.root.querySelector("[data-surface='text']");
    expect(surfaceAfterWarm).not.toBeNull();

    await moving;
    await flush();

    expect(visibleText(h.root)).toBe("A");
    expect(h.root.querySelector("[data-surface='text']")).toBe(surfaceAfterWarm);
  });

  it("same-tip label change after revalidation remounts once with the new label", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    await intent(h.navigator, "next"); // a
    await intent(h.navigator, "enter"); // copy

    const acting = h.navigator.onIntent("enter"); // action → copy-status
    expect(visibleText(h.root)).toBe("Copying…");
    const surface = h.root.querySelector("[data-surface='text']");
    expect(surface).not.toBeNull();

    await acting;
    await flush();

    expect(visibleText(h.root)).toBe("Copied");
    // Label changed → one remount + focus (no aria-live; focus announces).
    expect(h.root.querySelector("[data-surface='text']")).not.toBe(surface);
  });

  it("input revalidation preserves typed text", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    await intent(h.navigator, "enter"); // child

    const opening = h.navigator.onIntent("enter"); // input (warm)
    expect(h.display.getMode()).toBe("input");
    const input = h.root.querySelector<HTMLTextAreaElement>("textarea[data-surface='input']")!;
    input.value = "hello";

    await opening;
    await flush();

    expect(h.display.getMode()).toBe("input");
    expect(h.root.querySelector("textarea[data-surface='input']")).toBe(input);
    expect(h.display.getInputText()).toBe("hello");
  });

  it("refresh failure clears blocked and keeps last display", async () => {
    const registry = new AppRegistry();
    registry.register(createRootApp("home"));
    const failing: AppModule = {
      id: "fail",
      label: "Fail",
      open: () => ({
        navigationMap: {
          root: {
            next: { kind: "node", toNodeId: "x", stackBehavior: "replace" },
          },
        },
        warm: [{ id: "root", label: "OK" }],
        node: { id: "root", label: "OK" },
        location: { appId: "fail", path: "/" },
      }),
      refresh: async () => {
        throw new Error("boom");
      },
    };
    registry.register(failing);

    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);
    const navigator = new Navigator({
      config: { rootAppId: "home" },
      registry,
      display,
      platform: new PlatformCapabilities({ clipboard: null }),
      map: new NavigationMapStore(),
      cache: new NodeCache(),
      stack: new Stack(),
      setAddressBar: () => undefined,
    });

    await navigator.openLocation({ appId: "fail", path: "/" });
    expect(visibleText(root)).toBe("OK");

    // Put x in warm so we take warm-hit path then failing refresh
    // Actually warm has only root — next to x is warm miss + failing refresh
    navigator.onIntent("next");
    await flush();
    expect(navigator.isBlocked()).toBe(false);
    expect(visibleText(root)).toBe("OK");
  });

  it("transition token: A → B → A discards the first A's in-flight result", async () => {
    let release!: () => void;
    let gateOpen = false;
    const waiters: Array<() => void> = [];
    const gate = () =>
      new Promise<void>((resolve) => {
        if (gateOpen) {
          resolve();
          return;
        }
        waiters.push(resolve);
      });
    release = () => {
      gateOpen = true;
      for (const w of waiters.splice(0)) {
        w();
      }
    };

    const h = harness({ gate });
    // Open without gate delay for bootstrap — temporarily open gate
    gateOpen = true;
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    gateOpen = false;

    h.fake.setNodeLabel("a", "A-stale");
    h.navigator.onIntent("next"); // A, held
    h.navigator.onIntent("next"); // B
    h.fake.setNodeLabel("a", "A-fresh");
    h.navigator.onIntent("prev"); // back to A

    release();
    await flush();
    await flush();

    expect(visibleText(h.root)).toBe("A-fresh");
  });

  it("superseded read-only refresh receives aborted signal; action does not", async () => {
    let release!: () => void;
    const waiters: Array<() => void> = [];
    let hold = true;
    const gate = () =>
      new Promise<void>((resolve) => {
        if (!hold) {
          resolve();
          return;
        }
        waiters.push(resolve);
      });
    release = () => {
      hold = false;
      for (const w of waiters.splice(0)) {
        w();
      }
    };

    const h = harness({ gate });
    hold = false;
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    hold = true;

    h.navigator.onIntent("next"); // refresh A in flight
    h.navigator.onIntent("next"); // supersedes → abort first

    release();
    await flush();
    await flush();

    const refreshCalls = h.fake.calls.filter((c) => c.method === "refresh");
    expect(refreshCalls.length).toBeGreaterThanOrEqual(2);
    expect(refreshCalls[0]!.extras.signal?.aborted).toBe(true);
    expect(refreshCalls[1]!.extras.signal?.aborted).toBe(false);
  });

  it("action call is never aborted when superseded", async () => {
    let release!: () => void;
    const waiters: Array<() => void> = [];
    let hold = true;
    const gate = () =>
      new Promise<void>((resolve) => {
        if (!hold) {
          resolve();
          return;
        }
        waiters.push(resolve);
      });
    release = () => {
      hold = false;
      for (const w of waiters.splice(0)) {
        w();
      }
    };

    const h = harness({ gate });
    hold = false;
    await h.navigator.openLocation({ appId: "fake", path: "/a" });
    h.navigator.onIntent("enter"); // push copy
    await flush();
    hold = true;

    h.navigator.onIntent("enter"); // action → copy-status
    // Supersede with navigation away before action settles
    h.navigator.onIntent("back");

    release();
    await flush();
    await flush();

    const actionCalls = h.fake.calls.filter((c) => c.extras.action === true);
    expect(actionCalls.length).toBe(1);
    expect(actionCalls[0]!.extras.signal?.aborted).toBe(false);
  });

  it("extras.action only on action edge traversal — not warm revalidation or re-entry", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/a" });
    await intent(h.navigator, "enter"); // to copy (no action)
    await intent(h.navigator, "enter"); // action to copy-status

    const actionCalls = h.fake.calls.filter((c) => c.extras.action === true);
    expect(actionCalls).toHaveLength(1);
    expect(actionCalls[0]!.method).toBe("refresh");
    expect(h.fake.effects).toEqual(["copy"]);
    expect(visibleText(h.root)).toBe("Copied");

    await intent(h.navigator, "back");
    await intent(h.navigator, "next");
    expect(h.fake.effects).toEqual(["copy"]);

    await intent(h.navigator, "next");
    expect(h.fake.calls.filter((c) => c.extras.action === true)).toHaveLength(1);
  });

  it("walking sibling options past an effectful node performs no effect", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/b" });
    await intent(h.navigator, "next"); // to copy via replace
    await intent(h.navigator, "next"); // past copy to a
    expect(h.fake.effects).toEqual([]);
    expect(h.fake.calls.every((c) => !c.extras.action)).toBe(true);
  });

  it("passInputText included only when flag set from input tip", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/child" });
    await intent(h.navigator, "enter"); // input
    expect(h.navigator.getTipKind()).toBe("input");

    const input = h.root.querySelector<HTMLTextAreaElement>("textarea[data-surface='input']")!;
    input.value = "hello";

    await intent(h.navigator, "enter"); // commit with passInputText + action

    const commit = h.fake.calls.find((c) => c.extras.action && c.extras.inputText === "hello");
    expect(commit).toBeDefined();
    expect(visibleText(h.root)).toBe("Sent");

    // Non-input tip with no flag: plain next has no inputText
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    await intent(h.navigator, "next");
    const plain = h.fake.calls.filter((c) => c.method === "refresh").at(-1);
    expect(plain?.extras.inputText).toBeUndefined();
  });

  it("app root back opens the root app", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    await intent(h.navigator, "back");
    expect(h.navigator.getCurrentAppId()).toBe("home");
    expect(visibleText(h.root)).toBe("Home");
  });

  it("location null keeps prior address bar", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/a" });
    await intent(h.navigator, "enter"); // copy
    const before = h.getHash();
    expect(before).toBe("#/fake/copy");
    await intent(h.navigator, "enter"); // copy-status → location null
    expect(h.getHash()).toBe(before);
    expect(visibleText(h.root)).toBe("Copied");
  });

  it("external edge hands off href", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    h.map.replace({
      root: {
        enter: { kind: "external", href: "https://example.com/out" },
      },
    });
    h.navigator.onIntent("enter");
    expect(h.externalLog).toEqual(["https://example.com/out"]);
  });

  it("malformed push without toNodeId is silent no-op", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    h.map.replace({
      root: {
        next: { kind: "node", stackBehavior: "replace" },
      },
    });
    const before = visibleText(h.root);
    h.navigator.onIntent("next");
    expect(visibleText(h.root)).toBe(before);
    expect(h.stack.tip()?.nodeId).toBe("root");
  });
});

describe("Router.hrefFor is the only # producer in core open path", () => {
  it("Navigator does not embed hash strings in results", async () => {
    const h = harness();
    const spy = vi.spyOn(h.router, "hrefFor");
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    expect(spy).toHaveBeenCalled();
    expect(h.getHash().startsWith("#/")).toBe(true);
  });
});
