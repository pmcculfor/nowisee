import { describe, expect, it, vi } from "vitest";
import {
  PlatformCapabilities,
  type ClipboardHost,
} from "../src/core/platform.ts";

describe("PlatformCapabilities", () => {
  it("omits clipboard when the host cannot honour it", () => {
    const platform = new PlatformCapabilities({ clipboard: null });
    expect(platform.createContext().clipboard).toBeUndefined();
  });

  it("rejects writeText outside an action channel", async () => {
    const host: ClipboardHost = {
      writeText: vi.fn(async () => undefined),
    };
    const platform = new PlatformCapabilities({ clipboard: host });
    const ctx = platform.createContext();
    await expect(ctx.clipboard!.writeText("x")).rejects.toThrow(/only valid during an action/);
    expect(host.writeText).not.toHaveBeenCalled();
  });

  it("fallback path writes when the app supplies text during an action", async () => {
    const written: string[] = [];
    const host: ClipboardHost = {
      writeText: async (text) => {
        written.push(text);
      },
    };
    const platform = new PlatformCapabilities({ clipboard: host });
    const ctx = platform.createContext();

    platform.beginClipboardWrite();
    await ctx.clipboard!.writeText("verse");
    platform.endClipboardWrite();

    expect(written).toEqual(["verse"]);
  });

  it("delayed ClipboardItem path starts write on begin and resolves with app text", async () => {
    let delayed: Promise<string> | null = null;
    const host: ClipboardHost = {
      writeText: vi.fn(async () => undefined),
      writeWithDelayedText: async (textPromise) => {
        delayed = textPromise;
        await textPromise;
      },
    };
    const platform = new PlatformCapabilities({ clipboard: host });
    const ctx = platform.createContext();

    platform.beginClipboardWrite();
    expect(delayed).not.toBeNull();

    const write = ctx.clipboard!.writeText("copied");
    await expect(write).resolves.toBeUndefined();
    await expect(delayed!).resolves.toBe("copied");
    expect(host.writeText).not.toHaveBeenCalled();
    platform.endClipboardWrite();
  });

  it("cancels unused channel on endClipboardWrite", async () => {
    let delayed: Promise<string> | null = null;
    const host: ClipboardHost = {
      writeText: async () => undefined,
      writeWithDelayedText: async (textPromise) => {
        delayed = textPromise;
        await textPromise;
      },
    };
    const platform = new PlatformCapabilities({ clipboard: host });
    platform.beginClipboardWrite();
    platform.endClipboardWrite();
    await expect(delayed!).rejects.toThrow(/unused/);
  });

  it("last writeText wins when called twice in one action", async () => {
    const written: string[] = [];
    const host: ClipboardHost = {
      writeText: async (text) => {
        written.push(text);
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const platform = new PlatformCapabilities({ clipboard: host });
    const ctx = platform.createContext();

    platform.beginClipboardWrite();
    const first = ctx.clipboard!.writeText("first");
    const second = ctx.clipboard!.writeText("second");
    await expect(first).rejects.toThrow(/superseded/);
    await expect(second).resolves.toBeUndefined();
    platform.endClipboardWrite();

    expect(written).toEqual(["first", "second"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("propagates browser denial to the app promise", async () => {
    const host: ClipboardHost = {
      writeText: async () => {
        throw new Error("denied");
      },
    };
    const platform = new PlatformCapabilities({ clipboard: host });
    const ctx = platform.createContext();
    platform.beginClipboardWrite();
    await expect(ctx.clipboard!.writeText("x")).rejects.toThrow(/denied/);
    platform.endClipboardWrite();
  });
});
