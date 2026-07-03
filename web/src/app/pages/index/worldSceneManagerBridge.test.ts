import { describe, expect, it, vi } from "vitest";
import { APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE } from "@/shared/contracts/worldLayoutBridge";
import {
  isTrustedWorldLayoutBridgeOrigin,
  postWorldLayoutBridgeResult,
  readWorldLayoutBridgeRequest,
  resolveWorldLayoutBridgeReplyOrigin,
} from "@/app/pages/index/worldSceneManagerBridge";

describe("worldSceneManagerBridge", () => {
  const createApplyWorldLayoutMessage = ({
    requestId,
    worldLayoutUrl,
  }: {
    requestId: string;
    worldLayoutUrl: string;
  }) => ({
    type: "urdf-star:apply-world-layout-url",
    requestId,
    worldLayoutUrl,
  });

  it("accepts only same-origin and null-origin bridge messages", () => {
    expect(isTrustedWorldLayoutBridgeOrigin("https://studio.example", "https://studio.example")).toBe(
      true,
    );
    expect(isTrustedWorldLayoutBridgeOrigin("null", "https://studio.example")).toBe(true);
    expect(isTrustedWorldLayoutBridgeOrigin("https://attacker.example", "https://studio.example")).toBe(
      false,
    );
  });

  it("normalizes imported world-layout requests", () => {
    expect(
      readWorldLayoutBridgeRequest({
        ...createApplyWorldLayoutMessage({
          requestId: "request-1",
          worldLayoutUrl: " https://worlds.example/layout.json ",
        }),
      }),
    ).toEqual({
      kind: "import",
      requestId: "request-1",
      worldLayoutUrl: "https://worlds.example/layout.json",
    });
  });

  it("rejects blank world-layout URLs from valid bridge messages", () => {
    expect(
      readWorldLayoutBridgeRequest({
        ...createApplyWorldLayoutMessage({
          requestId: "request-2",
          worldLayoutUrl: "   ",
        }),
      }),
    ).toEqual({
      kind: "invalid",
      requestId: "request-2",
      message: "World layout URL is required.",
    });
  });

  it("ignores unrelated postMessage payloads", () => {
    expect(readWorldLayoutBridgeRequest({ type: "other", worldLayoutUrl: "https://example.test" })).toBe(
      null,
    );
  });

  it("uses wildcard replies for null origins", () => {
    expect(resolveWorldLayoutBridgeReplyOrigin("null")).toBe("*");
    expect(resolveWorldLayoutBridgeReplyOrigin("https://studio.example")).toBe("https://studio.example");
  });

  it("posts structured bridge results to reply targets", () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as MessageEventSource;

    postWorldLayoutBridgeResult({
      target,
      origin: "https://studio.example",
      requestId: "request-3",
      ok: true,
      message: "World layout applied.",
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE,
        requestId: "request-3",
        ok: true,
        message: "World layout applied.",
      },
      "https://studio.example",
    );
  });
});
