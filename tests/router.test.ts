import { describe, expect, it } from "vitest";
import { isAppId, Router } from "../src/core/router.ts";
import type { AppLocation } from "../src/core/types.ts";

describe("Router", () => {
  function makeRouter(onLocation: (loc: AppLocation) => void = () => undefined) {
    let path = "/";
    return new Router({
      rootAppId: "home",
      onLocation,
      location: {
        getPath: () => path,
        pushPath: (next) => {
          path = next;
        },
      },
      eventTarget: new EventTarget(),
    });
  }

  it("parses canonical root and root alias", () => {
    const router = makeRouter();
    expect(router.parse("/")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("/home")).toEqual({ appId: "home", path: "/" });
  });

  it("parses app paths without a client catalog", () => {
    const router = makeRouter();
    expect(router.parse("/bible/Matthew/5/8")).toEqual({
      appId: "bible",
      path: "/Matthew/5/8",
    });
    expect(router.parse("/fake")).toEqual({ appId: "fake", path: "/" });
    expect(router.parse("/nope")).toEqual({ appId: "nope", path: "/" });
    expect(router.parse("https://nowisee.app/bible/Matthew/5/8")).toEqual({
      appId: "bible",
      path: "/Matthew/5/8",
    });
  });

  it("corrupt or syntactically invalid href resolves to root", () => {
    const router = makeRouter();
    expect(router.parse("%%%")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("/NOPE")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("/nope!")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("/9bad")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("/admin")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("/api/apps/home/open")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("/oauth/callback")).toEqual({ appId: "home", path: "/" });
    expect(router.parse("/assets/index.js")).toEqual({ appId: "home", path: "/" });
  });

  it("isAppId is the default well-formed check", () => {
    expect(isAppId("bible")).toBe(true);
    expect(isAppId("my-app")).toBe(true);
    expect(isAppId("")).toBe(false);
    expect(isAppId("Bible")).toBe(false);
    expect(isAppId("admin")).toBe(false);
    expect(isAppId("api")).toBe(false);
    expect(isAppId("oauth")).toBe(false);
    expect(isAppId("assets")).toBe(false);
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
      { appId: "home", path: "/catalog" },
      { appId: "fake", path: "/" },
      { appId: "bible", path: "/Matthew/5/8" },
    ];
    for (const loc of locations) {
      expect(router.parse(router.hrefFor(loc))).toEqual(loc);
    }
  });

  it("setAddressBar does not re-enter onLocation", () => {
    const seen: AppLocation[] = [];
    const target = new EventTarget();
    let path = "/";
    const router = new Router({
      rootAppId: "home",
      onLocation: (loc) => {
        seen.push(loc);
      },
      location: {
        getPath: () => path,
        pushPath: (next) => {
          path = next;
        },
      },
      eventTarget: target,
    });
    router.attach();
    router.setAddressBar({ appId: "fake", path: "/a" });
    expect(path).toBe("/fake/a");
    expect(seen).toEqual([]);
  });

  it("external popstate forwards parsed location", () => {
    const seen: AppLocation[] = [];
    const target = new EventTarget();
    let path = "/";
    const router = new Router({
      rootAppId: "home",
      onLocation: (loc) => {
        seen.push(loc);
      },
      location: {
        getPath: () => path,
        pushPath: (next) => {
          path = next;
        },
      },
      eventTarget: target,
    });
    router.attach();
    path = "/fake/x";
    target.dispatchEvent(new Event("popstate"));
    expect(seen).toEqual([{ appId: "fake", path: "/x" }]);
  });
});
