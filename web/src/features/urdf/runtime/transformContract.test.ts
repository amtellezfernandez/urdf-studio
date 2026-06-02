import { describe, expect, it } from "vitest";

import { getTransformContract } from "./transformContract";

describe("transformContract", () => {
  it("defaults to strict parity with no hidden transforms", () => {
    const contract = getTransformContract();
    expect(contract.strictParity).toBe(true);
    expect(contract.allowUrdfMutation).toBe(false);
    expect(contract.allowAxisRemap).toBe(false);
    expect(contract.allowGeometryBake).toBe(false);
  });
});
