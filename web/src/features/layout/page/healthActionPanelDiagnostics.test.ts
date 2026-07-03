import { describe, expect, it } from "vitest";
import {
  buildExcludedLinkBucketKey,
  buildExcludedLinkGroups,
  buildExclusionReasonSummary,
  buildGeometryDiagnosisHeadline,
  buildGeometryDiagnosisNote,
  buildGeometryDiagnosisViewState,
  buildSanitizationSummary,
  countGeometryDiagnosisAttentionLinks,
  formatDiagnosticNumber,
  getPreparationVisualizationScope,
  type ExcludedLinkEntry,
} from "@/features/layout/page/healthActionPanelDiagnostics";
import {
  SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
  SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
} from "@/features/layout/page/simulationPrepViewerState";

const createExcludedLink = (
  overrides: Partial<ExcludedLinkEntry> = {}
): ExcludedLinkEntry => ({
  linkName: "link_a",
  reason: "degenerate-geometry",
  message: "Open mesh.",
  recoveryAction: null,
  recoveryEligible: false,
  recoveryMessage: null,
  recoveryDisposition: "none",
  ...overrides,
});

describe("healthActionPanelDiagnostics", () => {
  it("classifies recovery dispositions before raw exclusion reasons", () => {
    expect(buildExcludedLinkBucketKey(createExcludedLink({ recoveryDisposition: "recover" }))).toBe("voxel-ready");
    expect(buildExcludedLinkBucketKey(createExcludedLink({ recoveryDisposition: "regularize" }))).toBe("near-miss");
    expect(buildExcludedLinkBucketKey(createExcludedLink({ recoveryDisposition: "auto-exclude-ghost" }))).toBe("ghost-geometry");
    expect(buildExcludedLinkBucketKey(createExcludedLink({ reason: "invalid-scale" }))).toBe("invalid-scale");
  });

  it("orders excluded link groups by actionability", () => {
    const groups = buildExcludedLinkGroups([
      createExcludedLink({ linkName: "ghost", recoveryDisposition: "auto-exclude-ghost" }),
      createExcludedLink({ linkName: "recover", recoveryDisposition: "recover" }),
      createExcludedLink({ linkName: "regularize", recoveryDisposition: "regularize" }),
      createExcludedLink({ linkName: "proxy", recoveryDisposition: "manual-review-proxy" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "voxel-ready",
      "near-miss",
      "proxy-review",
      "ghost-geometry",
    ]);
    expect(buildExclusionReasonSummary(groups.flatMap((group) => group.linkEntries))).toEqual([
      "1 rescued and now voxel-ready",
      "1 can use PSD regularization",
      "1 need geometry attention",
      "1 removed as ghost geometry",
    ]);
  });

  it("maps actionable groups to viewer visualization scopes", () => {
    const [voxelGroup, nearMissGroup, ghostGroup] = buildExcludedLinkGroups([
      createExcludedLink({ linkName: "recover", recoveryDisposition: "recover" }),
      createExcludedLink({ linkName: "regularize", recoveryDisposition: "regularize" }),
      createExcludedLink({ linkName: "ghost", recoveryDisposition: "auto-exclude-ghost" }),
    ]);

    expect(getPreparationVisualizationScope(voxelGroup!)).toEqual({
      scopeKey: SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
      linkNames: ["recover"],
      label: "voxel-recovery",
    });
    expect(getPreparationVisualizationScope(nearMissGroup!)).toEqual({
      scopeKey: SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
      linkNames: ["regularize"],
      label: "PSD-regularization",
    });
    expect(getPreparationVisualizationScope(ghostGroup!)).toBeNull();
  });

  it("builds geometry diagnosis view state with active visualization scopes", () => {
    const state = buildGeometryDiagnosisViewState({
      activeInertiaVisualizationScopeKey: SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
      excludedLinks: [
        createExcludedLink({ linkName: "recover", recoveryDisposition: "recover" }),
        createExcludedLink({ linkName: "regularize", recoveryDisposition: "regularize" }),
        createExcludedLink({ linkName: "ghost", recoveryDisposition: "auto-exclude-ghost" }),
      ],
    });

    expect(state).toMatchObject({
      hasExcludedLinks: true,
      headline: "Geometry diagnosis • 3 flagged, 2 need attention",
      note: null,
      reasonSummaryText:
        "1 rescued and now voxel-ready | 1 can use PSD regularization | 1 removed as ghost geometry",
    });
    expect(
      state.groups.map((group) => ({
        active: group.isPreparationScopeActive,
        key: group.key,
        scopeKey: group.preparationVisualizationScope?.scopeKey ?? null,
      }))
    ).toEqual([
      {
        active: true,
        key: "voxel-ready",
        scopeKey: SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
      },
      {
        active: false,
        key: "near-miss",
        scopeKey: SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
      },
      {
        active: false,
        key: "ghost-geometry",
        scopeKey: null,
      },
    ]);
  });

  it("summarizes sanitization risk and geometry diagnosis copy", () => {
    const summary = buildSanitizationSummary([
      createExcludedLink({
        meshSanitization: [
          {
            status: "sanitized",
            massSignificance: "negligible",
            originalVertexCount: 100,
            finalVertexCount: 90,
            originalTriangleCount: 80,
            finalTriangleCount: 70,
            totalComponents: 3,
            removedComponents: 1,
            volumeRetainedRatio: 0.99,
            deletionSafetyReport: {
              status: "safe",
              isSafeToDelete: true,
              metrics: {
                comShiftMeters: 0,
                normalizedComShiftRatio: 0,
                massLossRatio: 0.001,
                inertiaTraceChangeRatio: 0.001,
                physicsImpactRatio: 0.002,
                maxAllowedComShiftMeters: 0.01,
                characteristicLengthMeters: 1,
              },
              reasons: [],
            },
          },
        ],
      }),
    ]);

    expect(summary).toEqual({
      status: "ok",
      sanitizedLinkCount: 1,
      blockedLinkCount: 0,
      maxPhysicsImpactRatio: 0.002,
    });
    expect(buildGeometryDiagnosisNote({ sanitizationSummary: summary })).toBe(
      "Precheck found removable disconnected geometry on 1 link (< 0.2% estimated physics impact)."
    );
    expect(buildGeometryDiagnosisHeadline({ excludedCount: 2, attentionCount: 1 })).toBe(
      "Geometry diagnosis • 2 flagged, 1 need attention"
    );
  });

  it("counts only non-ghost geometry entries as needing attention", () => {
    const links = [
      createExcludedLink({ recoveryDisposition: "auto-exclude-ghost" }),
      createExcludedLink({ recoveryDisposition: "manual-review-proxy" }),
    ];

    expect(countGeometryDiagnosisAttentionLinks(links)).toBe(1);
    expect(formatDiagnosticNumber(Number.NaN)).toBe("n/a");
    expect(formatDiagnosticNumber(0.00012)).toBe("1.20e-4");
  });
});
