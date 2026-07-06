import { describe, expect, it } from "vitest";

import { createLruCache, hashArrayBuffer, hashString } from "@/shared/lib/cache";

describe("cache", () => {
  it("evicts the least recently used entry", () => {
    const cache = createLruCache<number>(2);

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);

    cache.set("c", 3);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("hashes strings and array buffers deterministically", () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;

    expect(hashString("robot")).toBe(hashString("robot"));
    expect(hashArrayBuffer(buffer)).toBe(hashArrayBuffer(buffer));
    expect(hashArrayBuffer(new ArrayBuffer(0))).toBe("0");
  });
});
