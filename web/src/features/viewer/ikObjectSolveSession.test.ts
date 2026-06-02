import { describe, expect, it } from "vitest";
import { beginIkObjectSolveSession } from "@/features/viewer/ikObjectSolveSession";

describe("ikObjectSolveSession", () => {
  it("invalidates the previous solve immediately when a new session begins", () => {
    let currentToken = 0;
    const first = beginIkObjectSolveSession(
      () => currentToken,
      (token) => {
        currentToken = token;
      }
    );
    const second = beginIkObjectSolveSession(
      () => currentToken,
      (token) => {
        currentToken = token;
      }
    );

    expect(first.token).toBe(1);
    expect(second.token).toBe(2);
    expect(first.isStale()).toBe(true);
    expect(second.isStale()).toBe(false);
  });

  it("includes external invalidation when checking staleness", () => {
    let currentToken = 0;
    let externallyInvalid = false;
    const session = beginIkObjectSolveSession(
      () => currentToken,
      (token) => {
        currentToken = token;
      },
      () => externallyInvalid
    );

    expect(session.isStale()).toBe(false);
    externallyInvalid = true;
    expect(session.isStale()).toBe(true);
  });
});
