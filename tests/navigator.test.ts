/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from "vitest";
import { Display } from "../src/core/display.ts";
import { NavigationMapStore } from "../src/core/navigationMap.ts";
import { Navigator, LOAD_FAILURE_LABEL } from "../src/core/navigator.ts";
import { NodeCache } from "../src/core/nodeCache.ts";
import { PlatformCapabilities } from "../src/core/platform.ts";
import { AppRegistry } from "../src/core/registry.ts";
import { Router } from "../src/core/router.ts";
import { Stack } from "../src/core/stack.ts";
import type { AppLocation, AppModule, RefreshResult } from "../src/core/types.ts";
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
  resolveApp?: (appId: string) => AppModule | null;
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
    resolveApp: args?.resolveApp,
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

  it("unknown appId without resolveApp opens the root app", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "missing", path: "/" });
    expect(h.navigator.getCurrentAppId()).toBe("home");
    expect(visibleText(h.root)).toBe("Home");
  });

  it("resolveApp supplies a module the registry does not have", async () => {
    const lazy = createFakeApp({ id: "lazy", label: "Lazy", rootAppId: "home" });
    const h = harness({
      resolveApp: (id) => (id === "lazy" ? lazy.app : null),
    });
    await h.navigator.openLocation({ appId: "lazy", path: "/" });
    expect(h.navigator.getCurrentAppId()).toBe("lazy");
    expect(visibleText(h.root)).toBe("Root");
    expect(h.registry.get("lazy")).toBeNull();
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

  it("warm-miss refresh failure speaks recovery copy; enter retries without action", async () => {
    const registry = new AppRegistry();
    registry.register(createRootApp("home"));
    let remainingFails = 1;
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
        if (remainingFails > 0) {
          remainingFails -= 1;
          throw new Error("boom");
        }
        return {
          navigationMap: {
            x: {
              next: { kind: "node", toNodeId: "x", stackBehavior: "replace" },
            },
          },
          warm: [{ id: "x", label: "X" }],
          node: { id: "x", label: "X" },
          location: { appId: "fail", path: "/x" },
        };
      },
    };
    registry.register(failing);

    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);
    const stack = new Stack();
    const navigator = new Navigator({
      config: { rootAppId: "home" },
      registry,
      display,
      platform: new PlatformCapabilities({ clipboard: null }),
      map: new NavigationMapStore(),
      cache: new NodeCache(),
      stack,
      setAddressBar: () => undefined,
    });

    await navigator.openLocation({ appId: "fail", path: "/" });
    expect(visibleText(root)).toBe("OK");

    navigator.onIntent("next");
    await flush();
    expect(navigator.isBlocked()).toBe(false);
    expect(visibleText(root)).toBe(LOAD_FAILURE_LABEL);
    expect(stack.tip()?.nodeId).toBe("x");
    expect(navigator.getTipKind()).toBe("text");

    navigator.onIntent("next");
    await flush();
    expect(visibleText(root)).toBe(LOAD_FAILURE_LABEL);
    expect(stack.tip()?.nodeId).toBe("x");

    navigator.onIntent("enter");
    await flush();
    expect(visibleText(root)).toBe("X");
    expect(stack.tip()?.nodeId).toBe("x");
    expect(navigator.isBlocked()).toBe(false);
  });

  it("warm-miss failure back restores the previous node", async () => {
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
    const stack = new Stack();
    const navigator = new Navigator({
      config: { rootAppId: "home" },
      registry,
      display,
      platform: new PlatformCapabilities({ clipboard: null }),
      map: new NavigationMapStore(),
      cache: new NodeCache(),
      stack,
      setAddressBar: () => undefined,
    });

    await navigator.openLocation({ appId: "fail", path: "/" });
    navigator.onIntent("next");
    await flush();
    expect(visibleText(root)).toBe(LOAD_FAILURE_LABEL);

    navigator.onIntent("back");
    await flush();
    expect(visibleText(root)).toBe("OK");
    expect(stack.tip()?.nodeId).toBe("root");
    expect(navigator.isBlocked()).toBe(false);
  });

  it("warm-hit refresh failure keeps the cached dest, not recovery copy", async () => {
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
        warm: [
          { id: "root", label: "OK" },
          { id: "x", label: "X" },
        ],
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
    const stack = new Stack();
    const navigator = new Navigator({
      config: { rootAppId: "home" },
      registry,
      display,
      platform: new PlatformCapabilities({ clipboard: null }),
      map: new NavigationMapStore(),
      cache: new NodeCache(),
      stack,
      setAddressBar: () => undefined,
    });

    await navigator.openLocation({ appId: "fail", path: "/" });
    navigator.onIntent("next");
    await flush();
    expect(navigator.isBlocked()).toBe(false);
    expect(visibleText(root)).toBe("X");
    expect(stack.tip()?.nodeId).toBe("x");
  });

  it("malformed RefreshResult on a warm miss enters load recovery", async () => {
    const registry = new AppRegistry();
    registry.register(createRootApp("home"));
    const bad: AppModule = {
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
      refresh: () => ({}) as RefreshResult,
    };
    registry.register(bad);

    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);
    const stack = new Stack();
    const navigator = new Navigator({
      config: { rootAppId: "home" },
      registry,
      display,
      platform: new PlatformCapabilities({ clipboard: null }),
      map: new NavigationMapStore(),
      cache: new NodeCache(),
      stack,
      setAddressBar: () => undefined,
    });

    await navigator.openLocation({ appId: "fail", path: "/" });
    expect(visibleText(root)).toBe("OK");

    navigator.onIntent("next");
    await flush();
    expect(navigator.isBlocked()).toBe(false);
    expect(visibleText(root)).toBe(LOAD_FAILURE_LABEL);
    expect(stack.tip()?.nodeId).toBe("x");
  });

  it("transition token: A → B → A discards the first A's in-flight result as the tip", async () => {
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

  it("rapid next coalesces to one in-flight refresh and one pending", async () => {
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

    h.navigator.onIntent("next"); // A in flight
    h.navigator.onIntent("next"); // B pending (dropped)
    h.navigator.onIntent("next"); // copy pending

    expect(visibleText(h.root)).toBe("Copy");
    expect(h.stack.tip()?.nodeId).toBe("copy");

    release();
    await flush();
    await flush();
    await flush();

    const refreshCalls = h.fake.calls.filter((c) => c.method === "refresh");
    expect(refreshCalls).toHaveLength(2);
    expect(refreshCalls[0]!.extras.signal?.aborted).toBe(false);
    expect(refreshCalls[1]!.stack?.at(-1)?.nodeId).toBe("copy");
    expect(visibleText(h.root)).toBe("Copy");
  });

  it("covering stale refresh replaces warm and map without moving the tip", async () => {
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

    h.navigator.onIntent("next"); // A in flight
    h.navigator.onIntent("next"); // B pending

    release();
    await flush();
    await flush();
    await flush();

    expect(h.stack.tip()?.nodeId).toBe("b");
    expect(visibleText(h.root)).toBe("B");
    expect(h.cache.get("b")?.label).toBe("B");
    expect(h.map.lookup("b", "prev")?.kind).toBe("node");
    const refreshCalls = h.fake.calls.filter((c) => c.method === "refresh");
    expect(refreshCalls.length).toBe(2);
    expect(refreshCalls[1]!.stack?.at(-1)?.nodeId).toBe("b");
  });

  it("stale refresh that omits the live tip does not replace warm", async () => {
    let releaseFirst!: () => void;
    let firstHeld = true;
    const firstGate = () =>
      new Promise<void>((resolve) => {
        if (!firstHeld) {
          resolve();
          return;
        }
        releaseFirst = () => {
          firstHeld = false;
          resolve();
        };
      });

    const registry = new AppRegistry();
    registry.register(createRootApp("home"));
    let refreshCount = 0;
    const probe: AppModule = {
      id: "probe",
      label: "Probe",
      open() {
        return {
          navigationMap: {
            here: {
              next: { kind: "node", toNodeId: "mid", stackBehavior: "replace" },
            },
            mid: {
              next: { kind: "node", toNodeId: "there", stackBehavior: "replace" },
            },
          },
          warm: [
            { id: "here", label: "Here" },
            { id: "mid", label: "Mid" },
          ],
          node: { id: "here", label: "Here" },
          location: { appId: "probe", path: "/here" },
        };
      },
      async refresh(stack) {
        refreshCount += 1;
        const tipId = stack[stack.length - 1]?.nodeId ?? "here";
        if (refreshCount === 1) {
          await firstGate();
        }
        if (tipId === "mid") {
          return {
            navigationMap: {
              here: {
                next: { kind: "node", toNodeId: "mid", stackBehavior: "replace" },
              },
              mid: {
                next: { kind: "node", toNodeId: "there", stackBehavior: "replace" },
              },
            },
            warm: [
              { id: "here", label: "Here-stale" },
              { id: "mid", label: "Mid-stale" },
            ],
            node: { id: "mid", label: "Mid-stale" },
            location: { appId: "probe", path: "/mid" },
          };
        }
        return {
          navigationMap: {
            there: {
              prev: { kind: "node", toNodeId: "mid", stackBehavior: "replace" },
            },
          },
          warm: [{ id: "there", label: "There" }],
          node: { id: "there", label: "There" },
          location: { appId: "probe", path: "/there" },
        };
      },
    };
    registry.register(probe);

    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);
    const map = new NavigationMapStore();
    const cache = new NodeCache();
    const stack = new Stack();
    const navigator = new Navigator({
      config: { rootAppId: "home" },
      registry,
      display,
      platform: new PlatformCapabilities({ clipboard: { writeText: async () => undefined } }),
      map,
      cache,
      stack,
      setAddressBar: () => undefined,
    });

    await navigator.openLocation({ appId: "probe", path: "/here" });

    navigator.onIntent("next"); // mid, in-flight
    expect(visibleText(root)).toBe("Mid");
    expect(navigator.isBlocked()).toBe(false);

    navigator.onIntent("next"); // there, miss
    expect(navigator.isBlocked()).toBe(true);
    expect(stack.tip()?.nodeId).toBe("there");
    expect(visibleText(root)).toBe("Mid");

    releaseFirst!();
    await flush();
    await flush();
    await flush();

    expect(cache.get("here")?.label).not.toBe("Here-stale");
    expect(stack.tip()?.nodeId).toBe("there");
    expect(visibleText(root)).toBe("There");
    expect(refreshCount).toBe(2);
  });

  it("covering stale refresh paints a warm-miss dest and unblocks", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstHeld = true;
    let secondHeld = true;
    const firstGate = () =>
      new Promise<void>((resolve) => {
        if (!firstHeld) {
          resolve();
          return;
        }
        releaseFirst = () => {
          firstHeld = false;
          resolve();
        };
      });
    const secondGate = () =>
      new Promise<void>((resolve) => {
        if (!secondHeld) {
          resolve();
          return;
        }
        releaseSecond = () => {
          secondHeld = false;
          resolve();
        };
      });

    const registry = new AppRegistry();
    registry.register(createRootApp("home"));
    let refreshCount = 0;
    const probe: AppModule = {
      id: "probe",
      label: "Probe",
      open() {
        return {
          navigationMap: {
            here: {
              next: { kind: "node", toNodeId: "mid", stackBehavior: "replace" },
            },
            mid: {
              next: { kind: "node", toNodeId: "there", stackBehavior: "replace" },
            },
          },
          warm: [
            { id: "here", label: "Here" },
            { id: "mid", label: "Mid" },
          ],
          node: { id: "here", label: "Here" },
          location: { appId: "probe", path: "/here" },
        };
      },
      async refresh(stack) {
        refreshCount += 1;
        const tipId = stack[stack.length - 1]?.nodeId ?? "here";
        if (refreshCount === 1) {
          await firstGate();
        }
        if (refreshCount === 2) {
          await secondGate();
        }
        if (tipId === "mid") {
          return {
            navigationMap: {
              here: {
                next: { kind: "node", toNodeId: "mid", stackBehavior: "replace" },
              },
              mid: {
                next: { kind: "node", toNodeId: "there", stackBehavior: "replace" },
              },
              there: {
                prev: { kind: "node", toNodeId: "mid", stackBehavior: "replace" },
              },
            },
            warm: [
              { id: "here", label: "Here-stale" },
              { id: "mid", label: "Mid-stale" },
              { id: "there", label: "There" },
            ],
            node: { id: "mid", label: "Mid-stale" },
            location: { appId: "probe", path: "/mid" },
          };
        }
        return {
          navigationMap: {
            there: {
              prev: { kind: "node", toNodeId: "mid", stackBehavior: "replace" },
            },
          },
          warm: [{ id: "there", label: "There-fresh" }],
          node: { id: "there", label: "There-fresh" },
          location: { appId: "probe", path: "/there" },
        };
      },
    };
    registry.register(probe);

    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);
    const map = new NavigationMapStore();
    const cache = new NodeCache();
    const stack = new Stack();
    const navigator = new Navigator({
      config: { rootAppId: "home" },
      registry,
      display,
      platform: new PlatformCapabilities({ clipboard: { writeText: async () => undefined } }),
      map,
      cache,
      stack,
      setAddressBar: () => undefined,
    });

    await navigator.openLocation({ appId: "probe", path: "/here" });

    navigator.onIntent("next"); // mid, in-flight
    expect(visibleText(root)).toBe("Mid");

    navigator.onIntent("next"); // there, miss — display stays Mid
    expect(navigator.isBlocked()).toBe(true);
    expect(stack.tip()?.nodeId).toBe("there");
    expect(visibleText(root)).toBe("Mid");

    releaseFirst!();
    await flush();
    await flush();

    // Covering apply paints dest from the stale warm set; pending is still held.
    expect(stack.tip()?.nodeId).toBe("there");
    expect(visibleText(root)).toBe("There");
    expect(navigator.isBlocked()).toBe(false);
    expect(cache.get("there")?.label).toBe("There");
    expect(refreshCount).toBe(2);

    releaseSecond!();
    await flush();
    await flush();

    expect(visibleText(root)).toBe("There-fresh");
    expect(stack.tip()?.nodeId).toBe("there");
  });

  it("superseded read-only refresh is not aborted; pending runs after", async () => {
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
    h.navigator.onIntent("next"); // pending; first is not aborted

    release();
    await flush();
    await flush();

    const refreshCalls = h.fake.calls.filter((c) => c.method === "refresh");
    expect(refreshCalls[0]!.extras.signal?.aborted).toBe(false);
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

  it("copies clipboardText from an action result onto the device clipboard", async () => {
    const written: string[] = [];
    const h = harness({
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
    });
    await h.navigator.openLocation({ appId: "fake", path: "/a" });
    await intent(h.navigator, "enter");
    await intent(h.navigator, "enter");
    expect(written).toEqual(["copied-text"]);
    expect(visibleText(h.root)).toBe("Copied");
  });

  it("Copy reports clipboard unavailable when the host cannot copy", async () => {
    const h = harness({ clipboard: null });
    await h.navigator.openLocation({ appId: "fake", path: "/a" });
    await intent(h.navigator, "enter");
    await intent(h.navigator, "enter");
    expect(visibleText(h.root)).toContain("clipboard unavailable");
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
    const token = h.navigator.getTransitionToken();
    h.navigator.onIntent("next");
    expect(visibleText(h.root)).toBe(before);
    expect(h.stack.tip()?.nodeId).toBe("root");
    expect(h.navigator.getTransitionToken()).toBe(token);
  });

  it("malformed edge does not abort an in-flight refresh", async () => {
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
    h.map.replace({
      a: {
        next: { kind: "node", stackBehavior: "replace" },
      },
    });
    h.navigator.onIntent("next"); // malformed — must not abort

    h.fake.setNodeLabel("a", "A-from-flight");
    release();
    await flush();
    await flush();

    expect(visibleText(h.root)).toBe("A-from-flight");
    const refreshCalls = h.fake.calls.filter((c) => c.method === "refresh");
    expect(refreshCalls[0]!.extras.signal?.aborted).toBe(false);
  });

  it("failed open keeps the previous session", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    await intent(h.navigator, "next");
    expect(visibleText(h.root)).toBe("A");

    const boom: AppModule = {
      id: "boom",
      label: "Boom",
      open: () => {
        throw new Error("boom");
      },
      refresh: () => {
        throw new Error("boom");
      },
    };
    h.registry.register(boom);
    h.map.replace({
      a: {
        enter: { kind: "app", to: { appId: "boom", path: "/" } },
      },
    });

    await h.navigator.onIntent("enter");
    await flush();

    expect(h.navigator.isBlocked()).toBe(false);
    expect(h.navigator.getCurrentAppId()).toBe("fake");
    expect(visibleText(h.root)).toBe("A");
    expect(h.stack.tip()?.nodeId).toBe("a");
  });

  it("pop of the last entry opens Home without dropping the tip first", async () => {
    const h = harness();
    await h.navigator.openLocation({ appId: "fake", path: "/" });
    h.map.replace({
      root: {
        back: { kind: "node", stackBehavior: "pop" },
      },
    });
    await intent(h.navigator, "back");
    expect(h.navigator.getCurrentAppId()).toBe("home");
    expect(visibleText(h.root)).toBe("Home");
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
