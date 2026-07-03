import { describe, expect, it } from "vitest";
import {
  buildGeneratePhysicsDialogDescription,
  buildOverviewExtraNotes,
  buildOverviewLabelValueRows,
  buildPanelSubtitle,
  buildPhysicsActionLabel,
  buildPhysicsActionSummary,
  buildPlausibilityHeading,
} from "@/features/layout/page/healthActionPanelOverview";
import type { HealthActionPanelProps } from "@/features/layout/page/healthActionPanelTypes";

const createAudit = (
  overrides: Partial<NonNullable<HealthActionPanelProps["physicsAuditSummary"]>> = {}
): NonNullable<HealthActionPanelProps["physicsAuditSummary"]> => ({
  totalLinkCount: 10,
  presentLinkCount: 8,
  validLinkCount: 7,
  missingLinkCount: 1,
  invalidLinkCount: 1,
  repairableLinkCount: 0,
  totalMassKg: 3.25,
  ...overrides,
});

const createPlausibility = (
  overrides: Partial<NonNullable<HealthActionPanelProps["physicsPlausibilitySummary"]>> = {}
): NonNullable<HealthActionPanelProps["physicsPlausibilitySummary"]> => ({
  verdict: "plausible",
  comparableLinkCount: 7,
  excludedLinks: [],
  authoredMassKg: 3.25,
  lightEstimateMassKg: 2.5,
  heavyEstimateMassKg: 4.75,
  warning: null,
  offenders: [],
  ...overrides,
});

describe("healthActionPanelOverview", () => {
  it("summarizes plausibility verdicts with full and partial coverage", () => {
    expect(
      buildPlausibilityHeading({
        verdict: "plausible",
        comparableLinkCount: 8,
        presentLinkCount: 8,
      })
    ).toBe("Plausibility looks reasonable");
    expect(
      buildPlausibilityHeading({
        verdict: "mass-too-high",
        comparableLinkCount: 5,
        presentLinkCount: 8,
      })
    ).toBe("Partial plausibility warning");
    expect(
      buildPlausibilityHeading({
        verdict: "insufficient-data",
        comparableLinkCount: 0,
        presentLinkCount: 8,
      })
    ).toBe("Plausibility could not be verified");
  });

  it("prioritizes the most actionable panel subtitle", () => {
    expect(buildPanelSubtitle({ audit: null, excludedCount: 0 })).toBe("Checking robot readiness.");
    expect(
      buildPanelSubtitle({
        audit: createAudit({ repairableLinkCount: 2, missingLinkCount: 2, invalidLinkCount: 0 }),
        excludedCount: 4,
      })
    ).toBe("2 physics issues ready to fix.");
    expect(
      buildPanelSubtitle({
        audit: createAudit({ missingLinkCount: 0, invalidLinkCount: 0 }),
        excludedCount: 1,
      })
    ).toBe("1 skipped link need attention.");
  });

  it("describes the physics action dialog from available repair paths", () => {
    expect(
      buildGeneratePhysicsDialogDescription({
        audit: createAudit({ repairableLinkCount: 1 }),
        voxelRecoveryCount: 0,
        nearMissCount: 0,
        skippedLinkCount: 0,
      })
    ).toBe("Recalculate 1 missing or invalid inertial link with one material assumption.");
    expect(
      buildGeneratePhysicsDialogDescription({
        audit: createAudit({ missingLinkCount: 0, invalidLinkCount: 0 }),
        voxelRecoveryCount: 2,
        nearMissCount: 1,
        skippedLinkCount: 3,
      })
    ).toBe("3 links were skipped in check. 2 passed voxel recovery precheck and 1 can use PSD regularization.");
  });

  it("summarizes the primary physics action state", () => {
    expect(
      buildPhysicsActionSummary({
        onOpenGeneratePhysicsDialog: () => undefined,
        physicsPreflightLoading: true,
        physicsAuditSummary: null,
        voxelRecoveryCount: 0,
        nearMissCount: 0,
      })
    ).toEqual({
      disabled: true,
      summary: "Analyzing physics now. Wait for the audit before clicking.",
    });
    expect(
      buildPhysicsActionSummary({
        onOpenGeneratePhysicsDialog: () => undefined,
        physicsPreflightLoading: false,
        physicsAuditSummary: createAudit({ repairableLinkCount: 2 }),
        voxelRecoveryCount: 0,
        nearMissCount: 0,
      })
    ).toEqual({
      disabled: false,
      summary: "Repair 2 missing or invalid inertial links.",
    });
  });

  it("labels the primary physics action from the best available repair path", () => {
    expect(
      buildPhysicsActionLabel({
        physicsPreflightLoading: false,
        physicsAuditSummary: null,
        voxelRecoveryCount: 0,
        nearMissCount: 0,
      })
    ).toBe("Run physics check");
    expect(
      buildPhysicsActionLabel({
        physicsPreflightLoading: false,
        physicsAuditSummary: createAudit({ repairableLinkCount: 0 }),
        voxelRecoveryCount: 3,
        nearMissCount: 1,
      })
    ).toBe("Recover 3 prechecked skipped inertial links");
  });

  it("builds compact overview rows with plausibility details", () => {
    expect(
      buildOverviewLabelValueRows({
        statusLabel: "Physics Warning",
        physicsIssueSummary: "Mass looks high.",
        frameIssueSummary: "Frame needs review.",
        physicsAuditSummary: createAudit(),
        physicsPlausibilitySummary: createPlausibility(),
      })
    ).toEqual([
      { label: "Status", value: "Physics Warning" },
      { label: "Physics", value: "Mass looks high." },
      { label: "Frame", value: "Frame needs review.", emphasis: "result" },
      { label: "Inertials", value: "8/10 present" },
      { label: "Missing / Invalid", value: "1 missing • 1 invalid" },
      { label: "Authored Mass", value: "3.250 kg" },
      {
        label: "Plausibility",
        value: "Partial plausibility check • 7/8 comparable • 2.500-4.750 kg estimated",
        emphasis: "result",
      },
    ]);
  });

  it("keeps overview notes distinct from visible row values and each other", () => {
    expect(
      buildOverviewExtraNotes({
        statusSummary: "Mass looks high.",
        physicsPlausibilityWarning: "Mass looks high.",
        overviewRowValues: ["Physics Warning", "Mass looks high."],
      })
    ).toEqual([]);
    expect(
      buildOverviewExtraNotes({
        statusSummary: "Check authored material density.",
        physicsPlausibilityWarning: "Manual review recommended.",
        overviewRowValues: ["Physics Warning"],
      })
    ).toEqual(["Check authored material density.", "Manual review recommended."]);
  });
});
