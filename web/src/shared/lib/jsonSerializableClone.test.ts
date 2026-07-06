import { describe, expect, it } from "vitest";

import { cloneJsonSerializableValue } from "@/shared/lib/jsonSerializableClone";

describe("cloneJsonSerializableValue", () => {
  it("returns a deep copy for JSON-serializable data", () => {
    const source = {
      nested: {
        values: [1, 2, 3],
      },
    };

    const cloned = cloneJsonSerializableValue(source);

    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned.nested).not.toBe(source.nested);
    expect(cloned.nested.values).not.toBe(source.nested.values);
  });
});
