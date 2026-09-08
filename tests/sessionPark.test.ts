import { describe, expect, it } from "vitest";
import { SessionPark, type ParkedSession } from "../src/core/sessionPark.ts";

function session(appId: string, nodeId = "root"): ParkedSession {
  return {
    appId,
    stack: [{ nodeId, label: nodeId, location: { appId, path: `/${nodeId}` } }],
    tipKind: "text",
  };
}

describe("SessionPark", () => {
  it("put replaces the same appId and moves it to MRU front", () => {
    const park = new SessionPark();
    park.put(session("notes", "a"));
    park.put(session("bible"));
    park.put(session("notes", "b"));
    expect(park.list()).toEqual(["notes", "bible"]);
    expect(park.peek("notes")?.stack[0]?.nodeId).toBe("b");
  });

  it("take removes the snapshot; drop forgets an id", () => {
    const park = new SessionPark();
    park.put(session("notes"));
    park.put(session("bible"));
    expect(park.take("notes")?.appId).toBe("notes");
    expect(park.peek("notes")).toBeNull();
    expect(park.list()).toEqual(["bible"]);
    park.drop("bible");
    expect(park.list()).toEqual([]);
  });

  it("caps at 16, evicting the oldest", () => {
    const park = new SessionPark();
    for (let i = 0; i < 17; i++) {
      park.put(session(`app-${i}`));
    }
    expect(park.list()).toHaveLength(16);
    expect(park.peek("app-0")).toBeNull();
    expect(park.list()[0]).toBe("app-16");
    expect(park.list()[15]).toBe("app-1");
  });
});
