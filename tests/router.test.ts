import { describe, expect, it } from "vitest";
import { Router } from "../src/core/router.ts";
import type { AppLocation } from "../src/core/types.ts";

describe("Router", () => {
  const known = new Set(["home", "fake", "bible"]);

  function makeRouter(onLocation: (loc: AppLocation) => void = () => undefined) {
    let hash = "#/";
    return new Router({
      rootAppId: "home",
      isKnownApp: (id) => known.has(id),
      onLocation,
      location: {
        getHash: () => hash,
        setHash: (next) => {
          hash = next;
        },
      },
      eventTarget: new EventTarget(),
    });
  }

  it("parses canonical root and root alias", () => {
    const router = makeRouter();
    expect(router.parse("#/")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("#/home")).toEqual({ appId: "home", path: "/" });
  });

  it("parses app paths", () => {
    const router = makeRouter();
    expect(router.parse("#/bible/kjv/Matthew/5/8")).toEqual({
      appId: "bible",
      path: "/kjv/Matthew/5/8",
    });
    expect(router.parse("#/fake")).toEqual({ appId: "fake", path: "/" });
  });

  it("unknown or corrupt href resolves to root", () => {
    const router = makeRouter();
    expect(router.parse("#/nope")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("%%%")).toEqual({ appId: "home", path: "/" });
  });

  it("hrefFor rejects a path that does not start with /", () => {
    const router = makeRouter();
    expect(() => router.hrefFor({ appId: "fake", path: "no-slash" })).toThrow(
      /must be non-empty and start with/,
    );
    expect(() => router.hrefFor({ appId: "fake", path: "" })).toThrow(
      /must be non-empty and start with/,
    );
  });

  it("hrefFor round-trips with parse", () => {
    const router = makeRouter();
    const locations: AppLocation[] = [
      { appId: "home", path: "/" },
      { appId: "home", path: "/help" },
      { appId: "fake", path: "/" },
      { appId: "bible", path: "/kjv/Matthew/5/8" },
    ];
    for (const loc of locations) {
      expect(router.parse(router.hrefFor(loc))).toEqual(loc);
    }
  });

  it("setAddressBar does not re-enter onLocation via hashchange", () => {
    const seen: AppLocation[] = [];
    const target = new EventTarget();
    let hash = "#/";
    const router = new Router({
      rootAppId: "home",
      isKnownApp: (id) => known.has(id),
      onLocation: (loc) => {
        seen.push(loc);
      },
      location: {
        getHash: () => hash,
        setHash: (next) => {
          hash = next;
          target.dispatchEvent(new Event("hashchange"));
        },
      },
      eventTarget: target,
    });
    router.attach();
    router.setAddressBar({ appId: "fake", path: "/a" });
    expect(hash).toBe("#/fake/a");
    expect(seen).toEqual([]);
  });

  it("external hashchange forwards parsed location", () => {
    const seen: AppLocation[] = [];
    const target = new EventTarget();
    let hash = "#/";
    const router = new Router({
      rootAppId: "home",
      isKnownApp: (id) => known.has(id),
      onLocation: (loc) => {
        seen.push(loc);
      },
      location: {
        getHash: () => hash,
        setHash: (next) => {
          hash = next;
        },
      },
      eventTarget: target,
    });
    router.attach();
    hash = "#/fake/x";
    target.dispatchEvent(new Event("hashchange"));
    expect(seen).toEqual([{ appId: "fake", path: "/x" }]);
  });
});
