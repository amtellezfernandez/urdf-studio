// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX,
  STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX,
} from "@/features/layout/structureDragParams";
import {
  canDropInStructureGroup,
  parseStructureDragPayload,
  resolveCreateSubgroupOutcome,
  resolveKnownStructureGroupLabelSet,
  resolveStructureDragAutoScrollDelta,
  shouldClearStructureDragState,
  shouldCloseSubgroupCreatorForView,
  shouldCloseSubgroupCreatorWhenUnavailable,
  shouldIgnoreStructureDragStart,
  STRUCTURE_SUBGROUP_SUPPORTED_VIEWS,
} from "@/features/layout/structureGroupEditorHelpers";

describe("structureGroupEditorHelpers", () => {
  it("parses a valid drag payload", () => {
    expect(
      parseStructureDragPayload(
        JSON.stringify({
          sourceType: "joint",
          sourceName: "shoulder_joint",
          sourceGroupLabel: "arm1",
        })
      )
    ).toEqual({
      sourceType: "joint",
      sourceName: "shoulder_joint",
      sourceGroupLabel: "arm1",
    });
  });

  it("rejects invalid drag payloads", () => {
    expect(parseStructureDragPayload("")).toBeNull();
    expect(parseStructureDragPayload("{")).toBeNull();
    expect(
      parseStructureDragPayload(
        JSON.stringify({
          sourceType: "camera",
          sourceName: "cam1",
          sourceGroupLabel: "arm1",
        })
      )
    ).toBeNull();
  });

  it("checks whether a drop target is eligible", () => {
    expect(
      canDropInStructureGroup({
        canReassignStructureGroups: true,
        dragState: {
          sourceType: "link",
          sourceName: "base_link",
          sourceGroupLabel: "base",
        },
        targetGroupLabel: "arm1",
      })
    ).toBe(true);
    expect(
      canDropInStructureGroup({
        canReassignStructureGroups: false,
        dragState: {
          sourceType: "link",
          sourceName: "base_link",
          sourceGroupLabel: "base",
        },
        targetGroupLabel: "arm1",
      })
    ).toBe(false);
  });

  it("computes autoscroll deltas near the top and bottom edges", () => {
    expect(
      resolveStructureDragAutoScrollDelta({
        clientY: 10,
        containerTop: 0,
        containerBottom: 400,
      })
    ).toBeLessThan(0);
    expect(
      resolveStructureDragAutoScrollDelta({
        clientY: 390,
        containerTop: 0,
        containerBottom: 400,
      })
    ).toBeGreaterThan(0);
    expect(
      resolveStructureDragAutoScrollDelta({
        clientY: 200,
        containerTop: 0,
        containerBottom: 400,
      })
    ).toBe(0);
  });

  it("respects the configured maximum autoscroll step", () => {
    expect(
      resolveStructureDragAutoScrollDelta({
        clientY: 0,
        containerTop: 0,
        containerBottom: STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX * 2,
      })
    ).toBe(-STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX);
  });

  it("ignores drag starts when reassignment is disabled or a link button is clicked", () => {
    const button = document.createElement("button");
    const wrapper = document.createElement("div");
    wrapper.appendChild(button);

    expect(
      shouldIgnoreStructureDragStart({
        canReassignStructureGroups: false,
        dragState: {
          sourceType: "joint",
          sourceName: "shoulder_joint",
          sourceGroupLabel: "arm1",
        },
        targetElement: wrapper,
      })
    ).toBe(true);
    expect(
      shouldIgnoreStructureDragStart({
        canReassignStructureGroups: true,
        dragState: {
          sourceType: "link",
          sourceName: "base_link",
          sourceGroupLabel: "base",
        },
        targetElement: button,
      })
    ).toBe(true);
  });

  it("defines the supported subgroup creator views", () => {
    expect(STRUCTURE_SUBGROUP_SUPPORTED_VIEWS.has("links")).toBe(true);
    expect(STRUCTURE_SUBGROUP_SUPPORTED_VIEWS.has("flat")).toBe(true);
    expect(STRUCTURE_SUBGROUP_SUPPORTED_VIEWS.has("hierarchy")).toBe(false);
  });

  it("collects known group labels from custom, link, and joint labels", () => {
    expect(
      resolveKnownStructureGroupLabelSet({
        customStructureGroupLabels: ["arm2"],
        structureLabels: {
          linkByName: { base_link: "base", tool_link: " arm1 " },
          jointByName: { shoulder_joint: "arm1", wrist_joint: null },
        } as never,
      })
    ).toEqual(new Set(["arm2", "base", "arm1"]));
  });

  it("resolves subgroup creation outcomes", () => {
    expect(
      resolveCreateSubgroupOutcome({
        canReassignStructureGroups: false,
        knownStructureGroupLabelSet: new Set(),
        subgroupDraftLabel: "arm3",
      })
    ).toEqual({
      kind: "error",
      message: "Group editing is unavailable for this URDF.",
    });

    expect(
      resolveCreateSubgroupOutcome({
        canReassignStructureGroups: true,
        knownStructureGroupLabelSet: new Set(["arm3"]),
        subgroupDraftLabel: " arm3 ",
      })
    ).toEqual({
      kind: "info",
      message: "Arm3 already exists.",
    });

    expect(
      resolveCreateSubgroupOutcome({
        canReassignStructureGroups: true,
        knownStructureGroupLabelSet: new Set(["arm1"]),
        subgroupDraftLabel: " arm3 ",
      })
    ).toEqual({
      kind: "success",
      message: "Added subgroup Arm3.",
      normalizedLabel: "arm3",
    });
  });

  it("resolves subgroup/drag cleanup conditions", () => {
    expect(
      shouldCloseSubgroupCreatorForView({
        isSubgroupCreatorOpen: true,
        viewMode: "hierarchy",
      })
    ).toBe(true);
    expect(
      shouldCloseSubgroupCreatorWhenUnavailable({
        canReassignStructureGroups: false,
        isSubgroupCreatorOpen: false,
        subgroupDraftLabel: "arm2",
      })
    ).toBe(true);
    expect(
      shouldClearStructureDragState({
        activeStructureDrag: null,
        activeStructureDropGroup: "arm1",
        canReassignStructureGroups: false,
      })
    ).toBe(true);
  });
});
