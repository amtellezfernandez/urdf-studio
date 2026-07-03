import { describe, expect, it } from "vitest";
import {
  base64ToBlob,
  blobToBase64,
  bytesToBase64,
  serializeBlobPayload,
} from "@/shared/lib/blobEncoding";

describe("blobEncoding", () => {
  it("encodes bytes and blobs to base64", async () => {
    expect(bytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe("aGVsbG8=");
    await expect(blobToBase64(new Blob(["hello"]))).resolves.toBe("aGVsbG8=");
  });

  it("round trips serialized blob payloads", async () => {
    const payload = await serializeBlobPayload(new Blob(["mesh"], { type: "model/stl" }));
    const blob = base64ToBlob(payload);

    expect(payload).toEqual({
      base64Content: "bWVzaA==",
      mimeType: "model/stl",
    });
    await expect(blob.text()).resolves.toBe("mesh");
    expect(blob.type).toBe("model/stl");
  });

  it("uses caller-specific read errors", async () => {
    const failingBlob = {
      arrayBuffer: async () => {
        throw new Error("native read failure");
      },
    } as unknown as Blob;

    await expect(
      blobToBase64(failingBlob, {
        readErrorMessage: "Custom read failure.",
      })
    ).rejects.toThrow("Custom read failure.");
  });
});
