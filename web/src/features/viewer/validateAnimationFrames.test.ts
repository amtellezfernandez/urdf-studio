import { describe, expect, it } from "vitest";
import { validateAnimationFrames } from "@/features/viewer/validateAnimationFrames";
import { createDemoMotionSequences } from "@/shared/samples/demoMotion";

describe("validateAnimationFrames", () => {
  it("accepts valid monotonic frames", () => {
    const frames = [
      { timestamp: 0, joints: { j1: 0 } },
      { timestamp: 10, joints: { j1: 0.1 } },
      { timestamp: 20, joints: { j1: 0.2 } },
    ];
    const result = validateAnimationFrames(frames);
    expect(result.ok).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it("rejects non-finite timestamps", () => {
    const frames = [
      { timestamp: 0, joints: { j1: 0 } },
      { timestamp: Number.NaN, joints: { j1: 0.1 } },
    ];
    const result = validateAnimationFrames(frames);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toMatch(/timestamp/);
  });

  it("rejects non-finite joint values", () => {
    const frames = [
      { timestamp: 0, joints: { j1: 0 } },
      { timestamp: 10, joints: { j1: Infinity } },
    ];
    const result = validateAnimationFrames(frames);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toMatch(/joint/);
  });

  it("rejects decreasing timestamps", () => {
    const frames = [
      { timestamp: 20, joints: { j1: 0 } },
      { timestamp: 10, joints: { j1: 0.1 } },
    ];
    const result = validateAnimationFrames(frames);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toMatch(/monotonic/);
  });

  it("rejects frames with no joints", () => {
    const frames = [
      { timestamp: 0, joints: { j1: 0 } },
      { timestamp: 10, joints: {} },
    ];
    const result = validateAnimationFrames(frames);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toMatch(/no joints/);
  });

  it("warns on missing joint keys", () => {
    const frames = [
      { timestamp: 0, joints: { j1: 0, j2: 0.1 } },
      { timestamp: 10, joints: { j1: 0.2 } },
    ];
    const result = validateAnimationFrames(frames);
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/missing joint keys/);
  });

  it("demo motion sequences are valid", () => {
    const sequences = createDemoMotionSequences({ jointNames: ["j1", "j2"] });
    expect(sequences.length).toBeGreaterThan(0);
    sequences.forEach((sequence) => {
      const frames = sequence.frames.map((frame) => ({
        timestamp: frame.timestamp,
        joints: frame.jointPositions,
      }));
      const result = validateAnimationFrames(frames);
      expect(result.ok).toBe(true);
    });
  });
});
