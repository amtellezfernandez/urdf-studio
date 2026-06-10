import { describe, expect, it } from "vitest";
import {
  buildSimulationPrepUpdateToastPlan,
  buildSimulationPrepPreparationRefreshMessage,
  buildSimulationPrepDraftFingerprint,
  buildSimulationPrepPhysicsActionStatusMap,
  resolveSimulationPrepPreflightRequestDecision,
  resolveSimulationPrepPreparationRefreshStatus,
  canQueueSimulationPrepPhysicsAction,
  hasSimulationPrepPhysicsActionPending,
  buildPhysicsDraftSummaryText,
  buildPhysicsIssueSummary,
  buildSimulationPrepVisibilityKey,
  buildSimulationPrepStatus,
  resolveSimulationPrepPhysicsSourceContent,
} from "./simulationPrepState";

describe("buildSimulationPrepStatus", () => {
  it("returns danger when inertial tensors or masses are invalid", () => {
    expect(
      buildSimulationPrepStatus({
        robotFrameLint: null,
        missingInertialCount: 0,
        invalidMassCount: 1,
        invalidTensorCount: 0,
        inertialPlausibilitySummary: null,
        orientationSummary: null,
      })
    ).toEqual({
      tone: "danger",
      label: "Non-Physical (Simulation will crash)",
      summary: null,
    });
  });

  it("merges orientation and plausibility warnings into a warning summary", () => {
    expect(
      buildSimulationPrepStatus({
        robotFrameLint: {
          robotName: "demo",
          verdict: "asset-native",
          rewriteSafe: false,
          orientationCard: null,
          transformCompensation: {
            visualOrigins: 0,
            visualCompensatedOrigins: 0,
            collisionOrigins: 0,
            collisionCompensatedOrigins: 0,
            jointOrigins: 0,
            jointCompensatedOrigins: 0,
            geometryOrigins: 0,
            geometryCompensatedOrigins: 0,
            geometryCompensationRatio: 0,
            jointCompensationRatio: 0,
          },
          wheelStats: {
            wheelJointCount: 0,
            dominantAxis: null,
            dominantAxisVoteShare: 0,
            conflictsWithLikelyUpAxis: false,
          },
          issues: [],
        },
        missingInertialCount: 0,
        invalidMassCount: 0,
        invalidTensorCount: 0,
        inertialPlausibilitySummary: {
          verdict: "mass-too-high",
          comparableLinkCount: 2,
          excludedLinks: [],
          authoredMassKg: 10,
          lightEstimateMassKg: 4,
          heavyEstimateMassKg: 8,
          ratioToLightEstimate: 2.5,
          ratioToHeavyEstimate: 1.25,
          warning: "Mass looks high.",
          offenders: [],
        },
        orientationSummary: "Orientation needs review.",
      })
    ).toEqual({
      tone: "warning",
      label: "Physics Warning (Orientation / Inertia Issues)",
      summary: "Orientation needs review. Mass looks high.",
    });
  });
});

describe("buildPhysicsDraftSummaryText", () => {
  it("formats the staged physics summary without redundant mode text and with conditional voxel details", () => {
    expect(
      buildPhysicsDraftSummaryText({
        inertialSynthesisSummary: {
          targetedLinkCount: 4,
          synthesizedLinkCount: 3,
          skippedLinkCount: 0,
          collisionSourceLinkCount: 2,
          visualFallbackLinkCount: 1,
          voxelFallbackLinkCount: 1,
          psdRegularizedLinkCount: 1,
          repeatedMeshCanonicalizationGroupCount: 2,
          repeatedMeshCanonicalizationMeshReferences: [
            "meshes/shared_wheel.stl",
            "meshes/shared_arm.stl",
          ],
          warningCount: 0,
          totalMassKg: 1.5,
          synthesizedLinkNames: ["base", "arm", "wheel"],
          voxelFallbackLinkNames: ["wheel"],
          psdRegularizedLinkNames: ["arm"],
          skippedLinkNames: [],
          densityPresetId: "aluminum",
          densityLabel: "Aluminum",
          repairMode: "repair-missing-invalid",
        },
        inertialMassDeltaSummary: {
          changedLinkCount: 3,
          totalMassBeforeKg: 2,
          totalMassAfterKg: 1.5,
          totalMassDeltaKg: -0.5,
          largestChanges: [],
        },
      })
    ).toBe(
      "Physics draft staged for 3 of 4 targeted links using Aluminum. Collision-first: 2. Visual fallback: 1. Voxel-derived: 1. PSD-regularized: 1. Repeated mesh groups unified: 2. Total mass 2.000 -> 1.500 kg (-0.500)."
    );
  });
});

describe("buildPhysicsIssueSummary", () => {
  it("builds a compact issue summary from missing, invalid, and plausibility signals", () => {
    expect(
      buildPhysicsIssueSummary({
        missingInertialCount: 2,
        invalidMassCount: 1,
        invalidTensorCount: 0,
        inertialPlausibilitySummary: {
          verdict: "mass-too-high",
          comparableLinkCount: 2,
          excludedLinks: [],
          authoredMassKg: 10,
          lightEstimateMassKg: 4,
          heavyEstimateMassKg: 8,
          ratioToLightEstimate: 2.5,
          ratioToHeavyEstimate: 1.25,
          warning: "Mass looks high.",
          offenders: [],
        },
      })
    ).toBe("2 missing inertial links • 1 invalid inertial link • Mass looks high.");
  });
});

describe("buildSimulationPrepVisibilityKey", () => {
  it("changes when skipped-link review or staged draft content changes", () => {
    const physicsDraftKey = buildSimulationPrepDraftFingerprint(["aluminum", "repair-missing-invalid", 3, 1, 3, "1.500"]);
    const bakeDraftKey = buildSimulationPrepDraftFingerprint([88, 88, 44, 12345]);
    const canonicalDraftKey = buildSimulationPrepDraftFingerprint(["demo_robot", "base_link", 45, 44, "0.82", 6789]);
    const base = {
      frameVerdict: "canonical" as const,
      missingInertialCount: 0,
      invalidMassCount: 0,
      invalidTensorCount: 0,
      plausibilityVerdict: "plausible" as const,
      comparableLinkCount: 16,
      excludedLinkCount: 29,
      totalMassKg: 17.324,
      plausibilityWarning: null,
      physicsDraftKey,
      bakeDraftKey,
      canonicalDraftKey,
    };

    const first = buildSimulationPrepVisibilityKey(base);
    const changedDraft = buildSimulationPrepVisibilityKey({
      ...base,
      physicsDraftKey: buildSimulationPrepDraftFingerprint(["steel", "replace-all", 3, 1, 3, "2.100"]),
    });
    const changedSkippedLinks = buildSimulationPrepVisibilityKey({
      ...base,
      excludedLinkCount: 30,
    });

    expect(first).not.toBe(changedDraft);
    expect(first).not.toBe(changedSkippedLinks);
  });
});

describe("resolveSimulationPrepPhysicsSourceContent", () => {
  it("prefers the latest staged physics draft when present", () => {
    expect(
      resolveSimulationPrepPhysicsSourceContent({
        stagedDraftContent: "<robot name=\"draft\" />",
        baseContent: "<robot name=\"base\" />",
      })
    ).toBe("<robot name=\"draft\" />");
  });

  it("falls back to the base content when the staged draft is empty", () => {
    expect(
      resolveSimulationPrepPhysicsSourceContent({
        stagedDraftContent: "   ",
        baseContent: "<robot name=\"base\" />",
      })
    ).toBe("<robot name=\"base\" />");
  });
});

describe("buildSimulationPrepPhysicsActionStatusMap", () => {
  it("marks running actions ahead of queued actions while leaving the rest idle", () => {
    expect(
      buildSimulationPrepPhysicsActionStatusMap({
        runningActionKey: "voxel-recovery",
        queuedActionKeys: ["psd-regularize"],
      })
    ).toEqual({
      "repair-missing-invalid": "idle",
      "replace-all": "idle",
      "voxel-recovery": "running",
      "psd-regularize": "queued",
    });
  });
});

describe("resolveSimulationPrepPreparationRefreshStatus", () => {
  it("marks the refresh complete when both preflights succeed or are skipped", () => {
    expect(
      resolveSimulationPrepPreparationRefreshStatus({
        frameResult: "success",
        physicsResult: "skipped",
      })
    ).toEqual({
      status: "complete",
      ok: true,
    });
  });

  it("marks the refresh pending when either preflight is superseded", () => {
    expect(
      resolveSimulationPrepPreparationRefreshStatus({
        frameResult: "superseded",
        physicsResult: "success",
      })
    ).toEqual({
      status: "pending",
      ok: false,
    });
  });

  it("marks the refresh pending when either preflight is already running for the same source", () => {
    expect(
      resolveSimulationPrepPreparationRefreshStatus({
        frameResult: "pending",
        physicsResult: "success",
      })
    ).toEqual({
      status: "pending",
      ok: false,
    });
  });

  it("marks the refresh failed when either preflight fails", () => {
    expect(
      resolveSimulationPrepPreparationRefreshStatus({
        frameResult: "success",
        physicsResult: "failed",
      })
    ).toEqual({
      status: "failed",
      ok: false,
    });
  });
});

describe("buildSimulationPrepPreparationRefreshMessage", () => {
  it("returns no message for a complete refresh", () => {
    expect(
      buildSimulationPrepPreparationRefreshMessage({
        status: "complete",
      })
    ).toBeNull();
  });

  it("returns the failed-refresh message", () => {
    expect(
      buildSimulationPrepPreparationRefreshMessage({
        status: "failed",
      })
    ).toBe(
      "Preparation refresh failed. Previous status is still shown until the next successful check."
    );
  });

  it("returns the pending-refresh message", () => {
    expect(
      buildSimulationPrepPreparationRefreshMessage({
        status: "pending",
      })
    ).toBe(
      "Preparation refresh is still running. Previous status will stay visible until the new check completes."
    );
  });
});

describe("buildSimulationPrepUpdateToastPlan", () => {
  it("emits only the success toast when preparation refresh completes", () => {
    expect(
      buildSimulationPrepUpdateToastPlan({
        successMessage: "Mirror aligned.",
        preparationRefreshStatus: "complete",
      })
    ).toEqual({
      successMessage: "Mirror aligned.",
      followupMessage: null,
    });
  });

  it("emits the pending followup toast when preparation refresh is still running", () => {
    expect(
      buildSimulationPrepUpdateToastPlan({
        successMessage: "Mirror aligned.",
        preparationRefreshStatus: "pending",
      })
    ).toEqual({
      successMessage: "Mirror aligned.",
      followupMessage:
        "Preparation refresh is still running. Previous status will stay visible until the new check completes.",
    });
  });

  it("emits the failure followup toast when preparation refresh fails", () => {
    expect(
      buildSimulationPrepUpdateToastPlan({
        successMessage: "Mirror aligned.",
        preparationRefreshStatus: "failed",
      })
    ).toEqual({
      successMessage: "Mirror aligned.",
      followupMessage:
        "Preparation refresh failed. Previous status is still shown until the next successful check.",
    });
  });
});

describe("resolveSimulationPrepPreflightRequestDecision", () => {
  it("skips when the current session already matches and force is off", () => {
    expect(
      resolveSimulationPrepPreflightRequestDecision({
        force: false,
        matchesCurrentSession: true,
        isSameSourceInFlight: false,
      })
    ).toBe("skipped");
  });

  it("marks the request pending when the same source is already in flight", () => {
    expect(
      resolveSimulationPrepPreflightRequestDecision({
        force: true,
        matchesCurrentSession: false,
        isSameSourceInFlight: true,
      })
    ).toBe("pending");
  });

  it("starts a new request otherwise", () => {
    expect(
      resolveSimulationPrepPreflightRequestDecision({
        force: false,
        matchesCurrentSession: false,
        isSameSourceInFlight: false,
      })
    ).toBe("start");
  });
});

describe("hasSimulationPrepPhysicsActionPending", () => {
  it("returns true when any action is running or queued", () => {
    expect(
      hasSimulationPrepPhysicsActionPending({
        "voxel-recovery": "running",
      })
    ).toBe(true);
    expect(
      hasSimulationPrepPhysicsActionPending({
        "psd-regularize": "queued",
      })
    ).toBe(true);
  });

  it("returns false when every action is idle or absent", () => {
    expect(hasSimulationPrepPhysicsActionPending({})).toBe(false);
    expect(
      hasSimulationPrepPhysicsActionPending({
        "voxel-recovery": "idle",
        "psd-regularize": "idle",
      })
    ).toBe(false);
  });
});

describe("canQueueSimulationPrepPhysicsAction", () => {
  it("allows only the recover plus regularize diagnosis pair to stack", () => {
    expect(
      canQueueSimulationPrepPhysicsAction({
        runningActionKey: "voxel-recovery",
        queuedActionKeys: [],
        nextActionKey: "psd-regularize",
      })
    ).toBe(true);
    expect(
      canQueueSimulationPrepPhysicsAction({
        runningActionKey: "repair-missing-invalid",
        queuedActionKeys: [],
        nextActionKey: "replace-all",
      })
    ).toBe(false);
    expect(
      canQueueSimulationPrepPhysicsAction({
        runningActionKey: "voxel-recovery",
        queuedActionKeys: [],
        nextActionKey: "replace-all",
      })
    ).toBe(false);
  });

  it("rejects duplicate queued actions", () => {
    expect(
      canQueueSimulationPrepPhysicsAction({
        runningActionKey: "voxel-recovery",
        queuedActionKeys: ["psd-regularize"],
        nextActionKey: "psd-regularize",
      })
    ).toBe(false);
  });
});
