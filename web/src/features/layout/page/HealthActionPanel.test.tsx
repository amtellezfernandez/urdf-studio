/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealthActionPanel } from "./HealthActionPanel";
import {
  SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
  SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
  getSimulationPrepPanelInitialPosition,
} from "./simulationPrepPanelParams";
import {
  buildRobotMirrorSymmetryVisualizationScopeKey,
  buildRepeatedInertiaVisualizationScopeKey,
  buildRepeatedInertiaSymmetryFamilyOutcomeKey,
  buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey,
  SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
  SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
} from "./simulationPrepViewerState";

const getText = (node: ParentNode) => node.textContent ?? "";

describe("HealthActionPanel", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("opens on the left edge and can be dragged around", async () => {
    const VIEWPORT_WIDTH_PX = 1200;
    const VIEWPORT_HEIGHT_PX = 900;
    const DRAG_START_X_PX = 240;
    const DRAG_START_Y_PX = 80;
    const DRAG_TARGET_X_PX = 120;
    const DRAG_TARGET_Y_PX = 120;

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: VIEWPORT_WIDTH_PX,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: VIEWPORT_HEIGHT_PX,
    });

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
        })
      );
    });

    const panel = container.querySelector('[data-panel="simulation-prep"]') as HTMLDivElement | null;
    const dragHandle = container.querySelector('[data-drag-handle="simulation-prep"]') as HTMLDivElement | null;
    expect(panel).toBeTruthy();
    expect(dragHandle).toBeTruthy();

    const initialPosition = getSimulationPrepPanelInitialPosition(VIEWPORT_WIDTH_PX);
    expect(panel?.style.left).toBe(`${initialPosition.left}px`);
    expect(panel?.style.top).toBe(`${SIMULATION_PREP_PANEL_DEFAULT_TOP_PX}px`);

    await act(async () => {
      dragHandle?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: DRAG_START_X_PX,
          clientY: DRAG_START_Y_PX,
        })
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: DRAG_TARGET_X_PX,
          clientY: DRAG_TARGET_Y_PX,
        })
      );
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(panel?.style.left).toBe(
      `${Math.max(
        SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
        initialPosition.left - (DRAG_START_X_PX - DRAG_TARGET_X_PX)
      )}px`
    );
    expect(panel?.style.top).toBe(`${SIMULATION_PREP_PANEL_DEFAULT_TOP_PX + (DRAG_TARGET_Y_PX - DRAG_START_Y_PX)}px`);

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the recommended repair action for unsafe assets", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onGeneratePhysics = vi.fn();
    const onGenerateVoxelPhysics = vi.fn();
    const onGenerateRegularizedPhysics = vi.fn();
    const onOpenGeneratePhysicsDialog = vi.fn();
    const onRunAdvancedPrimaryAction = vi.fn();
    const onFixRepeatedInertiaSymmetryChain = vi.fn();
    const onRepeatedInertiaSymmetryCenterModeChange = vi.fn();
    const onToggleInertiaVisualizationScope = vi.fn();
    const onPreviewInertiaVisualizationScope = vi.fn();
    const onClearInertiaVisualizationPreview = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning (Orientation / Inertia Issues)",
          statusSummary:
            "This robot relies on local transform compensation. A global orientation rewrite is unsafe.",
          frameIssueSummary: "This robot relies on local transform compensation. A global orientation rewrite is unsafe.",
          physicsIssueSummary: "Mass looks high.",
          physicsAuditSummary: {
            totalLinkCount: 45,
            presentLinkCount: 45,
            validLinkCount: 45,
            missingLinkCount: 0,
            invalidLinkCount: 0,
            repairableLinkCount: 0,
            totalMassKg: 17.324,
          },
          physicsPlausibilitySummary: {
            verdict: "plausible",
            comparableLinkCount: 16,
            excludedLinks: [
              {
                linkName: "voxel_ready_link",
                reason: "degenerate-geometry",
                message: 'Mesh "voxel_ready_link.stl" produced degenerate mass properties.',
                recoveryAction: "voxel",
                recoveryEligible: true,
                recoveryMessage: null,
                recoveryDisposition: "recover",
                meshSanitization: [
                  {
                    status: "sanitized",
                    massSignificance: "negligible",
                    originalVertexCount: 120,
                    finalVertexCount: 96,
                    originalTriangleCount: 80,
                    finalTriangleCount: 64,
                    totalComponents: 3,
                    removedComponents: 2,
                    volumeRetainedRatio: 0.998,
                    deletionSafetyReport: {
                      status: "safe",
                      isSafeToDelete: true,
                      metrics: {
                        comShiftMeters: 0.00003,
                        normalizedComShiftRatio: 0.3,
                        massLossRatio: 0.0004,
                        inertiaTraceChangeRatio: 0.0002,
                        physicsImpactRatio: 0.0008,
                        maxAllowedComShiftMeters: 0.0001,
                        characteristicLengthMeters: 0.01,
                      },
                      reasons: [],
                    },
                  },
                ],
                diagnostics: {
                  bucket: "non-positive-definite",
                  eigenvalues: [-2e-4, -1e-4, 2e-4],
                  conditionNumber: null,
                  triangleInequalityGap: -5e-4,
                },
              },
              {
                linkName: "near_miss_link",
                reason: "invalid-inertia",
                message: 'Link "near_miss_link" produced a non-physical inertia tensor.',
                recoveryAction: "voxel",
                recoveryEligible: false,
                recoveryMessage: "Near-miss tensor can use PSD regularization.",
                recoveryDisposition: "regularize",
                diagnostics: {
                  bucket: "near-miss",
                  eigenvalues: [-2e-7, 1e-6, 2e-6],
                  conditionNumber: null,
                  triangleInequalityGap: -8e-7,
                },
              },
              {
                linkName: "ghost_link",
                reason: "degenerate-geometry",
                message: 'Link "ghost_link" collapses to digital dust after cleanup.',
                recoveryAction: null,
                recoveryEligible: false,
                recoveryMessage: "Removed: Ghost geometry detected (digital dust).",
                recoveryDisposition: "auto-exclude-ghost",
                meshSanitization: [
                  {
                    status: "excessive-deletion",
                    massSignificance: "negligible",
                    originalVertexCount: 500,
                    finalVertexCount: 12,
                    originalTriangleCount: 800,
                    finalTriangleCount: 8,
                    totalComponents: 89,
                    removedComponents: 88,
                    volumeRetainedRatio: 0.0004,
                    deletionSafetyReport: {
                      status: "manual-review",
                      isSafeToDelete: false,
                      metrics: {
                        comShiftMeters: 0.00001,
                        normalizedComShiftRatio: 0.1,
                        massLossRatio: 0.9996,
                        inertiaTraceChangeRatio: 0.0002,
                        physicsImpactRatio: 0.9996,
                        maxAllowedComShiftMeters: 0.0001,
                        characteristicLengthMeters: 0.01,
                      },
                      reasons: ["cleanup exceeded the retained-volume guardrail"],
                    },
                  },
                ],
                diagnostics: {
                  bucket: "non-positive-definite",
                  eigenvalues: [-2e-4, -1e-4, 2e-4],
                  conditionNumber: null,
                  triangleInequalityGap: -5e-4,
                },
              },
              {
                linkName: "proxy_link",
                reason: "invalid-inertia",
                message: 'Link "proxy_link" is a real part but the mesh is broken.',
                recoveryAction: null,
                recoveryEligible: false,
                recoveryMessage: "Error: Real part detected but mesh is broken. Needs Proxy.",
                recoveryDisposition: "manual-review-proxy",
                meshSanitization: [
                  {
                    status: "excessive-deletion",
                    massSignificance: "significant",
                    originalVertexCount: 400,
                    finalVertexCount: 220,
                    originalTriangleCount: 600,
                    finalTriangleCount: 320,
                    totalComponents: 4,
                    removedComponents: 1,
                    volumeRetainedRatio: 0.82,
                    deletionSafetyReport: {
                      status: "manual-review",
                      isSafeToDelete: false,
                      metrics: {
                        comShiftMeters: 0.004,
                        normalizedComShiftRatio: 4,
                        massLossRatio: 0.18,
                        inertiaTraceChangeRatio: 0.12,
                        physicsImpactRatio: 0.18,
                        maxAllowedComShiftMeters: 0.001,
                        characteristicLengthMeters: 0.1,
                      },
                      reasons: ["mass loss exceeded cleanup safety threshold"],
                    },
                  },
                ],
                diagnostics: {
                  bucket: "non-positive-definite",
                  eigenvalues: [-2e-4, -1e-4, 2e-4],
                  conditionNumber: null,
                  triangleInequalityGap: -5e-4,
                },
              },
            ],
            authoredMassKg: 6.824,
            lightEstimateMassKg: 4.2,
            heavyEstimateMassKg: 11.5,
            warning: null,
            offenders: [],
          },
          physicsDeltaSummary: {
            changedLinkCount: 3,
            totalMassBeforeKg: 17.324,
            totalMassAfterKg: 14.1,
            totalMassDeltaKg: -3.224,
            largestChanges: [
              {
                linkName: "battery",
                massBeforeKg: 1.2,
                massAfterKg: 0.8,
                deltaKg: -0.4,
              },
            ],
          },
          physicsVoxelFallbackLinkNames: ["arm_link"],
          onOpenGeneratePhysicsDialog,
          onGeneratePhysics,
          onGenerateVoxelPhysics,
          onGenerateRegularizedPhysics,
          onClose,
          repairOrientationLabel: "Export Cleanup",
          repairOrientationSummary: "Only needed when you want a cleaned canonical export.",
          repairOrientationDisabled: false,
          advancedPrimaryActionLabel: "Create Clean Export Draft",
          onRunAdvancedPrimaryAction,
          advancedSecondaryActionLabel: "Bake Meshes For Export",
          onRunAdvancedSecondaryAction: vi.fn(),
          synthesisRobotName: "demo_robot",
          synthesisRootLinkName: "base_link",
          synthesisLinkCount: 3,
          synthesisJointCount: 2,
          synthesisInferredUpLabel: "X-up",
          synthesisConfidence: 0.82,
          synthesisSupportEvidence: "Likely +x up from support-plane geometry.",
          synthesisSampleJoints: [
            {
              jointName: "base_to_arm",
              parentLinkName: "base_link",
              childLinkName: "arm_link",
              xyz: [1, 2, 0],
              rpy: [0, 0, 0],
            },
          ],
          onClearSynthesisPreview: vi.fn(),
          stagedEntryCount: 2,
          stagedMeshBackedEntryCount: 2,
          stagedLinkNames: ["base_link"],
          onClearStagedAction: vi.fn(),
          physicsDraftSummary: "Physics draft staged for 3 links using Aluminum.",
          physicsRepeatedMeshCanonicalizationSummaries: [
            {
              groupKey: "collision:meshes/shared_arm.stl:1 1 1",
              meshReference: "meshes/shared_arm.stl",
              linkNames: ["arm_left", "arm_right"],
            },
            {
              groupKey: "collision:meshes/shared_wheel.stl:1 1 1",
              meshReference: "meshes/shared_wheel.stl",
              linkNames: ["wheel_left", "wheel_right", "wheel_rear"],
            },
          ],
          repeatedInertiaSymmetryChains: [
            {
              branchCount: 3,
              rootMeshCenterPositionMeters: [0.012, -0.018, 0],
              symmetryCenterMode: "robot-center",
              symmetryCenterPositionMeters: [0, 0, 0],
              symmetryRootLinkName: "base_link",
              symmetryType: "radial",
              outlierBranchRootLinkName: "wheel_branch_rear",
              earliestDivergenceLinkName: "drive_motor_mount_rear",
              expectedAngleDegrees: 120,
              repeatedGroupCount: 4,
              repeatedMeshLabels: [
                "drive_motor_mount-v11.stl",
                "omni_wheel_mount-v5.stl",
                "shared_wheel.stl",
                "ST3215_Servo_Motor-v1.stl",
              ],
              branchRows: [
                {
                  branchRootLinkName: "wheel_branch_left",
                  representativeLinkName: "drive_motor_mount_left",
                  radialDistanceMeters: 0.0824,
                  idealRadialDistanceMeters: 0.0825,
                  radialDistanceDeltaMeters: 0.0001,
                  angleDegrees: 30,
                  idealAngleDegrees: 30,
                  idealPositionMeters: [0.0714470958, 0.04125, 0],
                  angularErrorDegrees: 0.2,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount_left",
                      idealPositionMeters: [0.0714470958, 0.04125, 0],
                      idealLayerRadiusMeters: 0.0825,
                      lateralOffsetMeters: 0.0001,
                      offsetDistanceMeters: 0.0002,
                      offsetVectorMeters: [0.0001, -0.0001, 0],
                      radialOffsetMeters: -0.0001,
                    },
                    {
                      linkName: "servo_motor_left",
                      idealPositionMeters: [0.0887676039, 0.05125, 0],
                      idealLayerRadiusMeters: 0.1025,
                      lateralOffsetMeters: 0.0001,
                      offsetDistanceMeters: 0.0003,
                      offsetVectorMeters: [0.00015, -0.00015, 0],
                      radialOffsetMeters: -0.0002,
                    },
                    {
                      linkName: "wheel_mount_left",
                      idealPositionMeters: [0.1060881119, 0.06125, 0],
                      idealLayerRadiusMeters: 0.1225,
                      lateralOffsetMeters: 0.0001,
                      offsetDistanceMeters: 0.0004,
                      offsetVectorMeters: [0.0002, -0.0002, 0],
                      radialOffsetMeters: -0.0003,
                    },
                    {
                      linkName: "wheel_left",
                      idealPositionMeters: [0.12340862, 0.07125, 0],
                      idealLayerRadiusMeters: 0.1425,
                      lateralOffsetMeters: 0.0001,
                      offsetDistanceMeters: 0.0005,
                      offsetVectorMeters: [0.00025, -0.00025, 0],
                      radialOffsetMeters: -0.0004,
                    },
                  ],
                  lateralOffsetMeters: 0.0001,
                  offsetDistanceMeters: 0.0002,
                  offsetVectorMeters: [0.0001, -0.0001, 0],
                  radialOffsetMeters: -0.0001,
                  status: "aligned",
                  rotationRadians: 0,
                  topologyMatchesFamily: true,
                },
                {
                  branchRootLinkName: "wheel_branch_right",
                  representativeLinkName: "drive_motor_mount_right",
                  radialDistanceMeters: 0.0825,
                  idealRadialDistanceMeters: 0.0825,
                  radialDistanceDeltaMeters: 0,
                  angleDegrees: 150,
                  idealAngleDegrees: 150,
                  idealPositionMeters: [-0.0714470958, 0.04125, 0],
                  angularErrorDegrees: 0.4,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount_right",
                      idealPositionMeters: [-0.0714470958, 0.04125, 0],
                      idealLayerRadiusMeters: 0.0825,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0,
                      offsetVectorMeters: [0, 0, 0],
                      radialOffsetMeters: 0,
                    },
                    {
                      linkName: "servo_motor_right",
                      idealPositionMeters: [-0.0887676039, 0.05125, 0],
                      idealLayerRadiusMeters: 0.1025,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0.0001,
                      offsetVectorMeters: [0.0001, 0, 0],
                      radialOffsetMeters: 0.0001,
                    },
                    {
                      linkName: "wheel_mount_right",
                      idealPositionMeters: [-0.1060881119, 0.06125, 0],
                      idealLayerRadiusMeters: 0.1225,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0.0001,
                      offsetVectorMeters: [0.0001, 0, 0],
                      radialOffsetMeters: 0.0001,
                    },
                    {
                      linkName: "wheel_right",
                      idealPositionMeters: [-0.12340862, 0.07125, 0],
                      idealLayerRadiusMeters: 0.1425,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0.0002,
                      offsetVectorMeters: [0.0002, 0, 0],
                      radialOffsetMeters: 0.0002,
                    },
                  ],
                  lateralOffsetMeters: 0,
                  offsetDistanceMeters: 0,
                  offsetVectorMeters: [0, 0, 0],
                  radialOffsetMeters: 0,
                  status: "aligned",
                  rotationRadians: 0,
                  topologyMatchesFamily: true,
                },
                {
                  branchRootLinkName: "wheel_branch_rear",
                  representativeLinkName: "drive_motor_mount_rear",
                  radialDistanceMeters: 0.1019,
                  idealRadialDistanceMeters: 0.0825,
                  radialDistanceDeltaMeters: 0.0194,
                  angleDegrees: 271.8,
                  idealAngleDegrees: 270,
                  idealPositionMeters: [0, -0.0825, 0],
                  angularErrorDegrees: 0.6,
                  rotationRadians: 0,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount_rear",
                      idealPositionMeters: [0, -0.0825, 0],
                      idealLayerRadiusMeters: 0.0825,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0.0194,
                      offsetVectorMeters: [0, 0.0194, 0],
                      radialOffsetMeters: 0.0194,
                    },
                    {
                      linkName: "servo_motor_rear",
                      idealPositionMeters: [0, -0.1025, 0],
                      idealLayerRadiusMeters: 0.1025,
                      lateralOffsetMeters: 0.0002,
                      offsetDistanceMeters: 0.0196,
                      offsetVectorMeters: [0, 0.0196, 0],
                      radialOffsetMeters: 0.0195,
                    },
                    {
                      linkName: "wheel_mount_rear",
                      idealPositionMeters: [0, -0.1225, 0],
                      idealLayerRadiusMeters: 0.1225,
                      lateralOffsetMeters: 0.0002,
                      offsetDistanceMeters: 0.0198,
                      offsetVectorMeters: [0, 0.0198, 0],
                      radialOffsetMeters: 0.0197,
                    },
                    {
                      linkName: "wheel_rear",
                      idealPositionMeters: [0, -0.1425, 0],
                      idealLayerRadiusMeters: 0.1425,
                      lateralOffsetMeters: 0.0002,
                      offsetDistanceMeters: 0.02,
                      offsetVectorMeters: [0, 0.02, 0],
                      radialOffsetMeters: 0.0199,
                    },
                  ],
                  lateralOffsetMeters: 0,
                  offsetDistanceMeters: 0.0194,
                  offsetVectorMeters: [0, 0.0194, 0],
                  radialOffsetMeters: 0.0194,
                  status: "outlier",
                  topologyMatchesFamily: true,
                },
              ],
              affectedLinkNames: [
                "drive_motor_mount_rear",
                "servo_motor_rear",
                "wheel_mount_rear",
                "wheel_rear",
              ],
              branchLinkGroups: [
                {
                  branchRootLinkName: "wheel_branch_left",
                  linkNames: [
                    "drive_motor_mount_left",
                    "servo_motor_left",
                    "wheel_mount_left",
                    "wheel_left",
                  ],
                  status: "aligned",
                },
                {
                  branchRootLinkName: "wheel_branch_right",
                  linkNames: [
                    "drive_motor_mount_right",
                    "servo_motor_right",
                    "wheel_mount_right",
                    "wheel_right",
                  ],
                  status: "aligned",
                },
                {
                  branchRootLinkName: "wheel_branch_rear",
                  linkNames: [
                    "drive_motor_mount_rear",
                    "servo_motor_rear",
                    "wheel_mount_rear",
                    "wheel_rear",
                  ],
                  status: "outlier",
                },
              ],
              siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
              maxAngularErrorDegrees: 1.2,
              maxDistanceDeltaMeters: 0.019,
              outlierAngularErrorDegrees: 0.6,
              topologyMatchingBranchCount: 3,
              recommendedRepair: {
                articulatedBoundaryJointName: null,
                blockedTargetLinkNames: [],
                kind: "translation",
                mode: "single-joint",
                stepCount: 1,
                summary: "Adjust base_to_motor_rear once to align one target position.",
                steps: [
                  {
                    childLinkName: "drive_motor_mount_rear",
                    jointName: "base_to_motor_rear",
                    parentLinkName: "base_link",
                    targetPositionMeters: [0, -0.0825, 0],
                  },
                ],
                targetLinkNames: ["drive_motor_mount_rear"],
              },
            },
          ],
          repeatedInertiaSymmetryCenterMode: "robot-center",
          repeatedInertiaDiagnostics: [
            {
              groupKey: "collision:shared_wheel.stl:1 1 1",
              meshLabel: "shared_wheel.stl",
              meshReference: "meshes/shared_wheel.stl",
              source: "collision",
              instanceCount: 3,
              issueKeys: ["confidence-mismatch"],
              issueSummary: ["Viewer confidence differs: high, medium."],
              physicalMismatch: false,
              massRelativeSpread: 0,
              principalMomentRelativeSpread: 0,
              meshLocalComMaxSeparationMeters: 0,
              confidenceValues: ["high", "medium"],
              strategyValues: ["principal"],
              linkEntries: [
                {
                  linkName: "wheel_left",
                  massKg: 1,
                  principalMomentsKgM2: [3, 2, 1],
                  meshLocalComMeters: [0, 0, 0],
                  confidence: "high",
                  strategy: "principal",
                  mismatchScore: 0.28,
                  mismatchBreakdown: { volume: 0.1, shape: 0.12, center: 0.06 },
                  centerOfMassOutsideReference: false,
                },
                {
                  linkName: "wheel_right",
                  massKg: 1,
                  principalMomentsKgM2: [3, 2, 1],
                  meshLocalComMeters: [0, 0, 0],
                  confidence: "medium",
                  strategy: "principal",
                  mismatchScore: 0.91,
                  mismatchBreakdown: { volume: 0.26, shape: 0.31, center: 0.34 },
                  centerOfMassOutsideReference: false,
                },
                {
                  linkName: "wheel_rear",
                  massKg: 1,
                  principalMomentsKgM2: [3, 2, 1],
                  meshLocalComMeters: [0, 0, 0],
                  confidence: "medium",
                  strategy: "principal",
                  mismatchScore: 1.18,
                  mismatchBreakdown: { volume: 0.22, shape: 0.41, center: 0.55 },
                  centerOfMassOutsideReference: true,
                },
              ],
            },
          ],
          onFixRepeatedInertiaSymmetryChain,
          onRepeatedInertiaSymmetryCenterModeChange,
          activeInertiaVisualizationScopeKey: null,
          onToggleInertiaVisualizationScope,
          onPreviewInertiaVisualizationScope,
          onClearInertiaVisualizationPreview,
          onClearPhysicsDraft: vi.fn(),
        })
      );
    });

    expect(getText(container)).toContain("Open In");
    const closePanelButton = container.querySelector('button[aria-label="Close workspace launcher panel"]');
    expect(closePanelButton).toBeTruthy();
    expect(getText(container)).toContain("Physics Warning");
    expect(getText(container)).not.toContain("Next Step");
    expect(getText(container)).toContain("Recover 1 skipped inertial link");
    expect(getText(container)).toContain(
      "1 rescued and now voxel-ready | 1 can use PSD regularization | 1 need geometry attention | 1 removed as ghost geometry"
    );
    expect(getText(container)).toContain("Voxel-derived links: 1");
    expect(getText(container)).toContain("Unified repeated meshes: 2");
    expect(getText(container)).toContain("Physics:");
    expect(getText(container)).toContain("Frame:");
    expect(getText(container)).toContain("Plausibility:");
    expect(getText(container)).toContain("Partial plausibility");
    expect(getText(container)).toContain("Geometry diagnosis • 4 flagged, 3 need attention");
    const symmetryPlanesSection = container.querySelector('[data-section="symmetry-planes"]');
    const symmetryChainsSection = container.querySelector('[data-section="symmetry-chains"]');
    expect(symmetryPlanesSection).toBeTruthy();
    expect(symmetryChainsSection).toBeTruthy();
    expect(container.querySelector('[data-section="repeated-parts"]')).toBeFalsy();
    expect(container.querySelector('[data-section="overlay-legend"]')).toBeFalsy();
    expect(
      container.querySelector('button[aria-label="How inertia overlays work"]')
    ).toBeFalsy();
    expect(getText(symmetryPlanesSection as ParentNode)).toContain("Symmetry Planes");
    expect(getText(symmetryPlanesSection as ParentNode)).toContain("Radial");
    const radialExpandButton = container.querySelector(
      'button[aria-label="Expand radial symmetry controls"]'
    );
    const collapsedSymmetryFixButton = container.querySelector(
      'button[aria-label="Auto-align symmetry branch wheel_branch_rear"]'
    );
    const collapsedSymmetryEyeButton = container.querySelector(
      'button[aria-label="Show symmetry guide for wheel_branch_rear"]'
    );
    expect(radialExpandButton).toBeTruthy();
    expect(collapsedSymmetryFixButton).toBeTruthy();
    expect(collapsedSymmetryEyeButton).toBeTruthy();
    expect(getText(symmetryChainsSection as ParentNode)).not.toContain("Geometry");

    await act(async () => {
      symmetryChainsSection?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(onPreviewInertiaVisualizationScope).toHaveBeenCalledWith(
      buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "wheel_branch_rear",
        siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
      }),
      [
        "drive_motor_mount_left",
        "drive_motor_mount_rear",
        "drive_motor_mount_right",
        "servo_motor_left",
        "servo_motor_rear",
        "servo_motor_right",
        "wheel_left",
        "wheel_mount_left",
        "wheel_mount_rear",
        "wheel_mount_right",
        "wheel_rear",
        "wheel_right",
      ],
      expect.objectContaining({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "wheel_branch_rear",
      })
    );

    await act(async () => {
      symmetryChainsSection?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(onClearInertiaVisualizationPreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      symmetryChainsSection?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggleInertiaVisualizationScope).toHaveBeenCalledTimes(1);
    expect(onToggleInertiaVisualizationScope).toHaveBeenCalledWith(
      buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "wheel_branch_rear",
        siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
      }),
      [
        "drive_motor_mount_left",
        "drive_motor_mount_rear",
        "drive_motor_mount_right",
        "servo_motor_left",
        "servo_motor_rear",
        "servo_motor_right",
        "wheel_left",
        "wheel_mount_left",
        "wheel_mount_rear",
        "wheel_mount_right",
        "wheel_rear",
        "wheel_right",
      ],
      expect.objectContaining({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "wheel_branch_rear",
        symmetryType: "radial",
      })
    );

    await act(async () => {
      collapsedSymmetryFixButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFixRepeatedInertiaSymmetryChain).toHaveBeenCalledTimes(1);
    expect(onFixRepeatedInertiaSymmetryChain).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outlierBranchRootLinkName: "wheel_branch_rear",
        recommendedRepair: expect.objectContaining({
          mode: "single-joint",
          stepCount: 1,
        }),
      })
    );

    await act(async () => {
      collapsedSymmetryEyeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggleInertiaVisualizationScope).toHaveBeenCalledTimes(2);
    expect(onToggleInertiaVisualizationScope).toHaveBeenLastCalledWith(
      buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "wheel_branch_rear",
        siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
      }),
      [
        "drive_motor_mount_left",
        "drive_motor_mount_rear",
        "drive_motor_mount_right",
        "servo_motor_left",
        "servo_motor_rear",
        "servo_motor_right",
        "wheel_left",
        "wheel_mount_left",
        "wheel_mount_rear",
        "wheel_mount_right",
        "wheel_rear",
        "wheel_right",
      ],
      expect.objectContaining({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "wheel_branch_rear",
        symmetryType: "radial",
      })
    );

    await act(async () => {
      radialExpandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(getText(symmetryChainsSection as ParentNode)).toContain(
      "[1] repeated branch family found (3 repeated branches)."
    );
    expect(getText(symmetryChainsSection as ParentNode)).toContain("base_link -> wheel_branch_rear");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Geometry");
    expect(getText(symmetryChainsSection as ParentNode)).toContain(
      "3 repeated branches on 3 branch planes (120.0° spacing)"
    );
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Blue lines");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Robot center");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Starts at");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("drive_motor_mount_rear");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Mesh support");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("4 repeated groups");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Topology");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("3/3 branches match");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Repair");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("1 joint move");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Max spread");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("19.0 mm");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Meshes");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("shared_wheel.stl");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Branch");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Chain");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Radius");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Angle");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Offset");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Status");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("drive_motor_mount_left");
    expect(getText(symmetryChainsSection as ParentNode)).toContain(
      "drive_motor_mount_left -> wheel_left"
    );
    expect(getText(symmetryChainsSection as ParentNode)).toContain("82.4 mm → 82.5 mm");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("30.0° → 30.0° (0.2° err)");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("0.2 mm (rad -0.1 mm • lat 0.1 mm)");
    expect(getText(symmetryChainsSection as ParentNode)).toContain(
      "Offsets: drive_motor_mount_left 0.2 mm (rad -0.1 mm • lat 0.1 mm)"
    );
    expect(getText(symmetryChainsSection as ParentNode)).toContain("drive_motor_mount_rear");
    expect(getText(symmetryChainsSection as ParentNode)).toContain(
      "drive_motor_mount_rear -> wheel_rear"
    );
    expect(getText(symmetryChainsSection as ParentNode)).toContain("101.9 mm → 82.5 mm");
    expect(getText(symmetryChainsSection as ParentNode)).toContain("271.8° → 270.0° (0.6° err)");
    expect(getText(symmetryChainsSection as ParentNode)).toContain(
      "19.4 mm (rad +19.4 mm • lat 0.0 mm)"
    );
    expect(getText(symmetryChainsSection as ParentNode)).toContain(
      "Offsets: drive_motor_mount_rear 19.4 mm (rad +19.4 mm • lat 0.0 mm)"
    );
    expect(getText(symmetryChainsSection as ParentNode)).toContain("Outlier");
    const symmetryFixButton = container.querySelector(
      'button[aria-label="Auto-align symmetry branch wheel_branch_rear"]'
    );
    const symmetryEyeButton = container.querySelector(
      'button[aria-label="Show symmetry guide for wheel_branch_rear"]'
    );
    expect(symmetryFixButton).toBeTruthy();
    expect(symmetryEyeButton).toBeTruthy();
    const symmetryCenterModeButton = container.querySelector(
      'button[aria-label="Use Root mesh center for symmetry blue lines"]'
    ) as HTMLButtonElement | null;
    expect(symmetryCenterModeButton).toBeTruthy();

    await act(async () => {
      symmetryCenterModeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRepeatedInertiaSymmetryCenterModeChange).toHaveBeenCalledWith(
      "root-mesh-center"
    );

    await act(async () => {
      symmetryFixButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFixRepeatedInertiaSymmetryChain).toHaveBeenCalledTimes(2);
    expect(onFixRepeatedInertiaSymmetryChain).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outlierBranchRootLinkName: "wheel_branch_rear",
        recommendedRepair: expect.objectContaining({
          mode: "single-joint",
          stepCount: 1,
        }),
      })
    );

    await act(async () => {
      symmetryEyeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggleInertiaVisualizationScope).toHaveBeenCalledTimes(3);
    expect(onToggleInertiaVisualizationScope).toHaveBeenLastCalledWith(
      buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "wheel_branch_rear",
        siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
      }),
      [
        "drive_motor_mount_left",
        "drive_motor_mount_rear",
        "drive_motor_mount_right",
        "servo_motor_left",
        "servo_motor_rear",
        "servo_motor_right",
        "wheel_left",
        "wheel_mount_left",
        "wheel_mount_rear",
        "wheel_mount_right",
        "wheel_rear",
        "wheel_right",
      ],
      expect.objectContaining({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "wheel_branch_rear",
        symmetryType: "radial",
      })
    );
    expect(getText(container)).not.toContain("Repeated Links");
    const voxelReadyEyeButton = container.querySelector(
      'button[aria-label="Show voxel-recovery inertia boxes"]'
    );
    expect(voxelReadyEyeButton).toBeTruthy();

    await act(async () => {
      voxelReadyEyeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggleInertiaVisualizationScope).toHaveBeenCalledWith(
      SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
      ["voxel_ready_link"]
    );
    const psdRegularizeEyeButton = container.querySelector(
      'button[aria-label="Show PSD-regularization inertia boxes"]'
    );
    expect(psdRegularizeEyeButton).toBeTruthy();

    await act(async () => {
      psdRegularizeEyeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggleInertiaVisualizationScope).toHaveBeenCalledWith(
      SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
      ["near_miss_link"]
    );
    const unifiedMeshesToggle = container.querySelector(
      'button[aria-label="Show unified repeated meshes"]'
    );
    expect(unifiedMeshesToggle).toBeTruthy();

    await act(async () => {
      unifiedMeshesToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getText(container)).toContain("meshes/shared_arm.stl");
    expect(getText(container)).toContain("meshes/shared_wheel.stl");
    const unifiedWheelButton = container.querySelector(
      'button[aria-label="Show unified repeated mesh inertia boxes for meshes/shared_wheel.stl"]'
    );
    expect(unifiedWheelButton).toBeTruthy();

    await act(async () => {
      unifiedWheelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggleInertiaVisualizationScope).toHaveBeenCalledWith(
      buildRepeatedInertiaVisualizationScopeKey("collision:meshes/shared_wheel.stl:1 1 1"),
      ["wheel_left", "wheel_right", "wheel_rear"]
    );
    expect(getText(container)).toContain(
      "Precheck flagged geometry: disconnected parts may be physically important."
    );
    expect(getText(container)).toContain("Why");
    expect(getText(container)).toContain("1 rescued and now voxel-ready");
    expect(getText(container)).toContain("1 can use PSD regularization");
    expect(getText(container)).toContain("1 removed as ghost geometry");
    expect(getText(container)).toContain("1 need geometry attention");
    expect(getText(container)).toContain("In URDF Studio, click Recover, then choose a material.");
    expect(getText(container)).toContain("In URDF Studio, click Regularize, then choose a material.");
    expect(getText(container)).toContain(
      "In URDF Studio, inspect the mesh first. Use a box or cylinder proxy only if the source mesh cannot be repaired."
    );
    const skippedLinksList = container.querySelector('[aria-label="Diagnosis details list"]');
    expect(skippedLinksList).toBeTruthy();
    expect(getText(container)).toContain("1 rescued and now voxel-ready");
    expect(getText(container)).toContain("1 removed as ghost geometry");
    expect(getText(container)).toContain("1 can use PSD regularization");
    expect(getText(container)).toContain("1 need geometry attention");
    expect(getText(container)).not.toContain("voxel_ready_link");
    expect(getText(container)).not.toContain("near_miss_link");
    expect(getText(container)).not.toContain("ghost_link");
    expect(getText(container)).not.toContain("proxy_link");

    const proxyGroupToggle = container.querySelector(
      'button[aria-label="Show 1 manual attention link"]'
    );
    expect(proxyGroupToggle).toBeTruthy();

    await act(async () => {
      proxyGroupToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getText(container)).toContain("proxy_link");
    const exportCleanupToggle = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Export Cleanup")
    );
    expect(exportCleanupToggle).toBeTruthy();

    await act(async () => {
      exportCleanupToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getText(container)).toContain("Baked Export Ready");
    expect(getText(container)).toContain("2 entries • 2 mesh-backed");
    expect(getText(container)).toContain("Clean Export Draft Ready");
    expect(getText(container)).toContain("demo_robot");
    expect(getText(container)).toContain("base_link");
    expect(getText(container)).toContain("X-up");
    expect(getText(container)).toContain("Z-up");
    expect(getText(container)).toContain("0.82");

    const actionButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Create Clean Export Draft")
    );
    expect(actionButton).toBeTruthy();

    await act(async () => {
      actionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRunAdvancedPrimaryAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      closePanelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    expect(getText(container)).toContain("Recover 1 skipped inertial link");
    expect(getText(container)).toContain("Regularize 1 near-miss inertial link");
    expect(getText(container)).not.toContain("Light");
    expect(getText(container)).not.toContain("Standard");
    expect(getText(container)).not.toContain("Heavy");
    expect(getText(container)).not.toContain("Recalculate all 45 inertial links");
    expect(getText(container)).not.toContain("Show advanced overwrite");

    const voxelRecoveryActionButton = container.querySelector(
      'button[aria-label="Recover 1 skipped inertial link"]'
    );
    const regularizeActionButton = container.querySelector(
      'button[aria-label="Regularize 1 near-miss inertial link"]'
    );
    expect(voxelRecoveryActionButton).toBeTruthy();
    expect(regularizeActionButton).toBeTruthy();
    expect(voxelRecoveryActionButton?.hasAttribute("disabled")).toBe(false);
    expect(regularizeActionButton?.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      voxelRecoveryActionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(getText(container)).toContain("Select Material");
    expect(getText(container)).toContain("Choose a material to continue.");

    let standardMaterialButtons = Array.from(
      container.querySelectorAll('button[aria-label="Standard physics material"]')
    );
    expect(standardMaterialButtons).toHaveLength(1);

    await act(async () => {
      standardMaterialButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onGenerateVoxelPhysics).toHaveBeenCalledWith("aluminum");

    await act(async () => {
      regularizeActionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    standardMaterialButtons = Array.from(
      container.querySelectorAll('button[aria-label="Standard physics material"]')
    );
    expect(standardMaterialButtons).toHaveLength(1);

    await act(async () => {
      standardMaterialButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onGenerateRegularizedPhysics).toHaveBeenCalledWith("aluminum");
    expect(onGeneratePhysics).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps voxel and regularize visible when all flagged links need manual review", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onGenerateVoxelPhysics = vi.fn();
    const onGenerateRegularizedPhysics = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning (Orientation / Inertia Issues)",
          physicsAuditSummary: {
            totalLinkCount: 45,
            presentLinkCount: 45,
            validLinkCount: 45,
            missingLinkCount: 0,
            invalidLinkCount: 0,
            repairableLinkCount: 0,
            totalMassKg: 17.324,
          },
          physicsPlausibilitySummary: {
            verdict: "insufficient-data",
            comparableLinkCount: 42,
            authoredMassKg: 17.324,
            lightEstimateMassKg: 2.699,
            heavyEstimateMassKg: 17.085,
            warning: null,
            offenders: [],
            excludedLinks: [
              {
                linkName: "proxy_link_a",
                reason: "invalid-inertia",
                message: 'Link "proxy_link_a" is a real part but the mesh is broken.',
                recoveryAction: null,
                recoveryEligible: false,
                recoveryMessage: "Needs manual proxy review.",
                recoveryDisposition: "manual-review-proxy",
                meshSanitization: [
                  {
                    status: "excessive-deletion",
                    massSignificance: "significant",
                    originalVertexCount: 400,
                    finalVertexCount: 220,
                    originalTriangleCount: 600,
                    finalTriangleCount: 320,
                    totalComponents: 4,
                    removedComponents: 1,
                    volumeRetainedRatio: 0.82,
                    deletionSafetyReport: {
                      status: "manual-review",
                      isSafeToDelete: false,
                      metrics: {
                        comShiftMeters: 0.004,
                        normalizedComShiftRatio: 4,
                        massLossRatio: 0.18,
                        inertiaTraceChangeRatio: 0.12,
                        physicsImpactRatio: 0.18,
                        maxAllowedComShiftMeters: 0.001,
                        characteristicLengthMeters: 0.1,
                      },
                      reasons: ["mass loss exceeded cleanup safety threshold"],
                    },
                  },
                ],
                diagnostics: {
                  bucket: "non-positive-definite",
                  eigenvalues: [-2e-4, -1e-4, 2e-4],
                  conditionNumber: null,
                  triangleInequalityGap: -5e-4,
                },
              },
              {
                linkName: "proxy_link_b",
                reason: "degenerate-geometry",
                message: 'Mesh "proxy_link_b.stl" would need unsafe cleanup.',
                recoveryAction: null,
                recoveryEligible: false,
                recoveryMessage: "Needs manual proxy review.",
                recoveryDisposition: "manual-review-proxy",
                meshSanitization: [
                  {
                    status: "excessive-deletion",
                    massSignificance: "significant",
                    originalVertexCount: 420,
                    finalVertexCount: 240,
                    originalTriangleCount: 640,
                    finalTriangleCount: 360,
                    totalComponents: 5,
                    removedComponents: 2,
                    volumeRetainedRatio: 0.8,
                    deletionSafetyReport: {
                      status: "manual-review",
                      isSafeToDelete: false,
                      metrics: {
                        comShiftMeters: 0.003,
                        normalizedComShiftRatio: 3,
                        massLossRatio: 0.2,
                        inertiaTraceChangeRatio: 0.11,
                        physicsImpactRatio: 0.2,
                        maxAllowedComShiftMeters: 0.001,
                        characteristicLengthMeters: 0.1,
                      },
                      reasons: ["inertia trace change exceeded cleanup safety threshold"],
                    },
                  },
                ],
                diagnostics: {
                  bucket: "non-positive-definite",
                  eigenvalues: [-3e-4, -2e-4, 3e-4],
                  conditionNumber: null,
                  triangleInequalityGap: -6e-4,
                },
              },
            ],
          },
          onGenerateVoxelPhysics,
          onGenerateRegularizedPhysics,
        })
      );
    });

    expect(getText(container)).toContain("Recover skipped inertial links");
    expect(getText(container)).toContain("Regularize near-miss inertial links");
    expect(getText(container)).toContain("No links available for voxel recovery.");
    expect(getText(container)).toContain("No links available for PSD regularization.");

    const recoverButton = container.querySelector(
      'button[aria-label="Recover skipped inertial links"]'
    );
    const regularizeButton = container.querySelector(
      'button[aria-label="Regularize near-miss inertial links"]'
    );
    expect(recoverButton).toBeTruthy();
    expect(regularizeButton).toBeTruthy();
    expect(recoverButton?.hasAttribute("disabled")).toBe(true);
    expect(regularizeButton?.hasAttribute("disabled")).toBe(true);
    expect(getText(recoverButton as ParentNode)).toContain("No Links Available");
    expect(getText(regularizeButton as ParentNode)).toContain("No Links Available");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the detected robot-wide mirror plane in simulation prep", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onToggleInertiaVisualizationScope = vi.fn();
    const onPreviewInertiaVisualizationScope = vi.fn();
    const onClearInertiaVisualizationPreview = vi.fn();
    const onToggleRobotMirrorSelectionLink = vi.fn();
    const onAlignRobotMirrorOrientation = vi.fn();
    const onFixRobotMirrorSymmetry = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          activeInertiaVisualizationScopeKey: null,
          onToggleInertiaVisualizationScope,
          onPreviewInertiaVisualizationScope,
          onClearInertiaVisualizationPreview,
          onAlignRobotMirrorOrientation,
          onFixRobotMirrorSymmetry,
          onToggleRobotMirrorSelectionLink,
          robotMirrorSelectionLinks: [
            {
              counterpartLinkName: null,
              groupKey: "group:arm",
              groupLinkCount: 2,
              linkName: "arm_left",
              meshLabel: "arm.stl",
              preselected: true,
              status: "review",
              defaultExclusionReason: null,
            },
            {
              counterpartLinkName: null,
              groupKey: "group:arm",
              groupLinkCount: 2,
              linkName: "arm_right",
              meshLabel: "arm.stl",
              preselected: false,
              status: "available",
              defaultExclusionReason: null,
            },
            {
              counterpartLinkName: null,
              groupKey: "group:sensor",
              groupLinkCount: 2,
              linkName: "sensor_left",
              meshLabel: "sensor.stl",
              preselected: false,
              status: "available",
              defaultExclusionReason: null,
            },
            {
              counterpartLinkName: "wheel_right",
              groupKey: "group:wheel",
              groupLinkCount: 2,
              linkName: "wheel_left",
              meshLabel: "wheel.stl",
              preselected: false,
              status: "paired",
              defaultExclusionReason: "radial-symmetry",
            },
            {
              counterpartLinkName: "wheel_left",
              groupKey: "group:wheel",
              groupLinkCount: 2,
              linkName: "wheel_right",
              meshLabel: "wheel.stl",
              preselected: false,
              status: "paired",
              defaultExclusionReason: "radial-symmetry",
            },
          ],
          selectedRobotMirrorLinkNames: ["arm_left"],
          robotMirrorVisualizationLinkNames: ["arm_left", "arm_right"],
          robotMirrorOutcome: {
            tone: "success",
            message: "Centered 1 mirror target across 1 selected mesh with 1 joint.",
            linkResults: [
              {
                counterpartLinkName: "arm_right",
                finalResidualMeters: 0,
                linkName: "arm_left",
                movedDistanceMeters: 0.0012,
                orientationDecision: "preserve-current",
                orientationSkipReason: null,
                planeNormalResidualRadians: 0.2,
                repairMode: "position-only",
                rotationAppliedRadians: 0,
                selectionStatus: "paired",
              },
              {
                counterpartLinkName: null,
                finalResidualMeters: 0,
                linkName: "camera_move_v31",
                movedDistanceMeters: 0.0008,
                orientationDecision: "preserve-current",
                orientationSkipReason: "rotation-too-large",
                planeNormalResidualRadians: 0.24,
                repairMode: "position-only",
                rotationAppliedRadians: 0,
                selectionStatus: "centered",
              },
            ],
          },
          robotMirrorSymmetryCheck: {
            planeLabel: "xz",
            originMeters: [0, 0, 0],
            planeNormalWorld: [0, 1, 0],
            supportedGroupCount: 3,
            supportedLinkCount: 6,
            supportedLinkNames: [
              "arm_left",
              "arm_right",
              "spine_lower",
              "spine_upper",
              "wheel_left",
              "wheel_right",
            ],
            totalRepeatedLinkCount: 6,
            centeredLinkCount: 2,
            centeredLinkNames: ["spine_lower", "spine_upper"],
            matchedPairCount: 3,
            averageResidualMeters: 0.0015,
            maxResidualMeters: 0.003,
            pairedGroupCount: 3,
            pairedLinkCount: 6,
            matchedPairs: [],
            reviewGroups: [
              {
                groupKey: "group:arm",
                maxResidualMeters: 0.003,
                meshLabel: "arm.stl",
                supportedLinkCount: 0,
                totalLinkCount: 2,
                unsupportedLinkNames: ["arm_left", "arm_right"],
              },
            ],
            reviewLinkCount: 2,
          },
        })
      );
    });

    const symmetryPlanesSection = container.querySelector('[data-section="symmetry-planes"]');
    const mirrorSection = container.querySelector('[data-section="robot-mirror-symmetry"]');
    const mirrorEyeButton = container.querySelector(
      'button[aria-label="Show robot-wide mirror plane guide"]'
    );
    const mirrorExpandButton = container.querySelector(
      'button[aria-label="Expand mirror controls"]'
    );
    expect(symmetryPlanesSection).toBeTruthy();
    expect(mirrorSection).toBeTruthy();
    expect(mirrorEyeButton).toBeTruthy();
    expect(mirrorExpandButton).toBeTruthy();
    expect(getText(symmetryPlanesSection as ParentNode)).toContain("Symmetry Planes");
    expect(getText(symmetryPlanesSection as ParentNode)).toContain("Mirror");
    expect(getText(mirrorSection as ParentNode)).toContain("Mirror");
    expect(getText(mirrorSection as ParentNode)).toContain("XZ plane");
    expect(getText(mirrorSection as ParentNode)).toContain("1 selected");
    expect(getText(mirrorSection as ParentNode)).toContain("Make Parallel");
    expect(getText(mirrorSection as ParentNode)).toContain("Center Mirror");
    expect(getText(mirrorSection as ParentNode)).toContain("1 mesh");
    expect(getText(mirrorSection as ParentNode)).toContain("1 link");
    expect(getText(mirrorSection as ParentNode)).not.toContain("arm.stl");
    expect(getText(mirrorSection as ParentNode)).not.toContain("Selected link results");

    await act(async () => {
      mirrorSection?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggleInertiaVisualizationScope).toHaveBeenCalledWith("robot-mirror:xz", [
      "arm_left",
      "arm_right",
    ]);

    await act(async () => {
      mirrorExpandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(getText(mirrorSection as ParentNode)).toContain("arm.stl");
    expect(getText(mirrorSection as ParentNode)).toContain("sensor.stl");
    expect(getText(mirrorSection as ParentNode)).toContain("wheel.stl");
    expect(getText(mirrorSection as ParentNode)).toContain("arm_left");
    expect(getText(mirrorSection as ParentNode)).toContain("peer wheel_right");
    expect(getText(mirrorSection as ParentNode)).toContain("2 links");
    expect(getText(mirrorSection as ParentNode)).not.toContain(
      "Centered 1 mirror target across 1 selected mesh with 1 joint."
    );
    expect(getText(mirrorSection as ParentNode)).not.toContain("Selected link results");
    expect(getText(mirrorSection as ParentNode)).toContain("position only");
    expect(getText(mirrorSection as ParentNode)).toContain("move 1.2 mm");
    expect(getText(mirrorSection as ParentNode)).not.toContain("camera_move_v31");
    expect(getText(mirrorSection as ParentNode)).toContain("2 radial");
    expect(getText(mirrorSection as ParentNode)).toContain("3.0 mm");

    await act(async () => {
      mirrorSection?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(onPreviewInertiaVisualizationScope).toHaveBeenCalledWith(
      buildRobotMirrorSymmetryVisualizationScopeKey({
        planeLabel: "xz",
      } as const),
      ["arm_left", "arm_right"]
    );

    await act(async () => {
      mirrorSection?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(onClearInertiaVisualizationPreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      mirrorEyeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggleInertiaVisualizationScope).toHaveBeenLastCalledWith("robot-mirror:xz", [
      "arm_left",
      "arm_right",
    ]);

    const mirrorAlignButton = container.querySelector(
      'button[aria-label="Center selected mirror links"]'
    );
    const mirrorOrientationButton = container.querySelector(
      'button[aria-label="Align selected mirror link orientation"]'
    );
    await act(async () => {
      mirrorOrientationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAlignRobotMirrorOrientation).toHaveBeenCalledTimes(1);
    await act(async () => {
      mirrorAlignButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFixRobotMirrorSymmetry).toHaveBeenCalledTimes(1);

    const wheelSelectionCheckbox = container.querySelector(
      'button[aria-label="Select mirror link wheel_left"]'
    );
    await act(async () => {
      wheelSelectionCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggleRobotMirrorSelectionLink).toHaveBeenCalledWith("wheel_left");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows loading only for the active mirror action while both mirror buttons stay locked", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          robotMirrorSelectionLinks: [
            {
              counterpartLinkName: null,
              groupKey: "group:arm",
              groupLinkCount: 1,
              linkName: "arm_center",
              meshLabel: "arm.stl",
              preselected: true,
              status: "centered",
              defaultExclusionReason: null,
            },
          ],
          selectedRobotMirrorLinkNames: ["arm_center"],
          robotMirrorSymmetryCheck: {
            planeLabel: "xz",
            originMeters: [0, 0, 0],
            planeNormalWorld: [0, 1, 0],
            supportedGroupCount: 1,
            supportedLinkCount: 1,
            supportedLinkNames: ["arm_center"],
            totalRepeatedLinkCount: 1,
            centeredLinkCount: 1,
            centeredLinkNames: ["arm_center"],
            matchedPairCount: 0,
            averageResidualMeters: 0,
            maxResidualMeters: 0,
            pairedGroupCount: 0,
            pairedLinkCount: 0,
            matchedPairs: [],
            reviewGroups: [],
            reviewLinkCount: 0,
          },
          onAlignRobotMirrorOrientation: vi.fn(),
          onFixRobotMirrorSymmetry: vi.fn(),
          isRobotMirrorActing: true,
          activeRobotMirrorAction: "orientation-only",
        })
      );
    });

    const makeParallelButton = container.querySelector(
      'button[aria-label="Align selected mirror link orientation"]'
    ) as HTMLButtonElement | null;
    const centerMirrorButton = container.querySelector(
      'button[aria-label="Center selected mirror links"]'
    ) as HTMLButtonElement | null;
    expect(makeParallelButton).toBeTruthy();
    expect(centerMirrorButton).toBeTruthy();
    expect(makeParallelButton?.disabled).toBe(true);
    expect(centerMirrorButton?.disabled).toBe(true);
    expect(makeParallelButton?.querySelector(".animate-spin")).toBeTruthy();
    expect(centerMirrorButton?.querySelector(".animate-spin")).toBeFalsy();

    await act(async () => {
      root.unmount();
    });
  });

  it("locks mirror, radial, and physics repair actions while another simulation-prep fix is running", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          isSimulationPrepFixBusy: true,
          onAlignRobotMirrorOrientation: vi.fn(),
          onFixRobotMirrorSymmetry: vi.fn(),
          onFixRepeatedInertiaSymmetryChain: vi.fn(),
          onGeneratePhysics: vi.fn(),
          onRepairOrientation: vi.fn(),
          repairOrientationLabel: "Export Cleanup",
          repairOrientationSummary: "Cleanup export transforms.",
          robotMirrorSelectionLinks: [
            {
              counterpartLinkName: null,
              groupKey: "group:arm",
              groupLinkCount: 1,
              linkName: "arm_center",
              meshLabel: "arm.stl",
              preselected: true,
              status: "centered",
              defaultExclusionReason: null,
            },
          ],
          selectedRobotMirrorLinkNames: ["arm_center"],
          robotMirrorSymmetryCheck: {
            planeLabel: "xz",
            originMeters: [0, 0, 0],
            planeNormalWorld: [0, 1, 0],
            supportedGroupCount: 1,
            supportedLinkCount: 1,
            supportedLinkNames: ["arm_center"],
            totalRepeatedLinkCount: 1,
            centeredLinkCount: 1,
            centeredLinkNames: ["arm_center"],
            matchedPairCount: 0,
            averageResidualMeters: 0,
            maxResidualMeters: 0,
            pairedGroupCount: 0,
            pairedLinkCount: 0,
            matchedPairs: [],
            reviewGroups: [],
            reviewLinkCount: 0,
          },
          repeatedInertiaSymmetryCenterMode: "robot-center",
          repeatedInertiaSymmetryChains: [
            {
              symmetryRootLinkName: "base_link",
              outlierBranchRootLinkName: "wheel_branch_rear",
              earliestDivergenceLinkName: "drive_motor_mount_rear",
              symmetryType: "radial",
              branchCount: 3,
              expectedAngleDegrees: 120,
              repeatedGroupCount: 1,
              repeatedMeshLabels: ["shared_wheel.stl"],
              symmetryCenterMode: "robot-center",
              symmetryCenterPositionMeters: [0, 0, 0],
              rootMeshCenterPositionMeters: [0, 0, 0],
              siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
              maxAngularErrorDegrees: 2.5,
              maxDistanceDeltaMeters: 0.01,
              outlierAngularErrorDegrees: 2.5,
              topologyMatchingBranchCount: 3,
              recommendedRepair: {
                kind: "translation",
                mode: "single-joint",
                summary: "Adjust 1 joint to restore radial alignment.",
                targetLinkNames: ["drive_motor_mount_rear"],
                blockedTargetLinkNames: [],
                articulatedBoundaryJointName: null,
                stepCount: 1,
                steps: [
                  {
                    childLinkName: "drive_motor_mount_rear",
                    jointName: "joint_rear",
                    parentLinkName: "base_link",
                    targetPositionMeters: [0, -0.08, 0],
                  },
                ],
              },
              affectedLinkNames: ["drive_motor_mount_rear"],
              branchLinkGroups: [
                {
                  branchRootLinkName: "wheel_branch_rear",
                  linkNames: ["drive_motor_mount_rear"],
                  status: "outlier",
                },
              ],
              branchRows: [
                {
                  branchRootLinkName: "wheel_branch_rear",
                  representativeLinkName: "drive_motor_mount_rear",
                  radialDistanceMeters: 0.09,
                  idealRadialDistanceMeters: 0.08,
                  radialDistanceDeltaMeters: 0.01,
                  angleDegrees: 270,
                  idealAngleDegrees: 270,
                  idealPositionMeters: [0, -0.08, 0],
                  angularErrorDegrees: 0,
                  rotationRadians: 0,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount_rear",
                      idealPositionMeters: [0, -0.08, 0],
                      idealLayerRadiusMeters: 0.08,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0.01,
                      offsetVectorMeters: [0, 0.01, 0],
                      radialOffsetMeters: 0.01,
                    },
                  ],
                  lateralOffsetMeters: 0,
                  offsetDistanceMeters: 0.01,
                  offsetVectorMeters: [0, 0.01, 0],
                  radialOffsetMeters: 0.01,
                  status: "outlier",
                  topologyMatchesFamily: true,
                },
              ],
            },
          ],
          physicsAuditSummary: {
            totalLinkCount: 2,
            presentLinkCount: 2,
            validLinkCount: 0,
            missingLinkCount: 1,
            invalidLinkCount: 1,
            repairableLinkCount: 2,
            totalMassKg: 1.5,
          },
          onOpenGeneratePhysicsDialog: vi.fn(),
        })
      );
    });

    expect(
      (
        container.querySelector(
          'button[aria-label="Align selected mirror link orientation"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(true);
    expect(
      (
        container.querySelector(
          'button[aria-label="Center selected mirror links"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(true);
    expect(
      (
        container.querySelector(
          'button[aria-label="Auto-align symmetry branch wheel_branch_rear"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(true);
    expect(
      (
        container.querySelector(
          'button[aria-label="Recalculate 2 missing / invalid inertial links"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Export Cleanup")
      )?.hasAttribute("disabled")
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("disables mirror actions while availability reloads and after no further mirror fix remains", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const mirrorProps = {
      open: true,
      statusTone: "warning" as const,
      onAlignRobotMirrorOrientation: vi.fn(),
      onFixRobotMirrorSymmetry: vi.fn(),
      robotMirrorSelectionLinks: [
        {
          counterpartLinkName: null,
          groupKey: "group:arm",
          groupLinkCount: 1,
          linkName: "arm_center",
          meshLabel: "arm.stl",
          preselected: true,
          status: "centered" as const,
          defaultExclusionReason: null,
        },
      ],
      selectedRobotMirrorLinkNames: ["arm_center"],
      robotMirrorSymmetryCheck: {
        planeLabel: "xz" as const,
        originMeters: [0, 0, 0] as [number, number, number],
        planeNormalWorld: [0, 1, 0] as [number, number, number],
        supportedGroupCount: 1,
        supportedLinkCount: 1,
        supportedLinkNames: ["arm_center"],
        totalRepeatedLinkCount: 1,
        centeredLinkCount: 1,
        centeredLinkNames: ["arm_center"],
        matchedPairCount: 0,
        averageResidualMeters: 0,
        maxResidualMeters: 0,
        pairedGroupCount: 0,
        pairedLinkCount: 0,
        matchedPairs: [],
        reviewGroups: [],
        reviewLinkCount: 0,
      },
    };

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          ...mirrorProps,
          isRobotMirrorAvailabilityLoading: true,
          canAlignRobotMirrorOrientation: false,
          canFixRobotMirrorSymmetry: false,
        })
      );
    });

    const makeParallelButton = container.querySelector(
      'button[aria-label="Align selected mirror link orientation"]'
    ) as HTMLButtonElement | null;
    const centerMirrorButton = container.querySelector(
      'button[aria-label="Center selected mirror links"]'
    ) as HTMLButtonElement | null;
    expect(
      (
        container.querySelector(
          'button[aria-label="Align selected mirror link orientation"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(true);
    expect(
      (
        container.querySelector(
          'button[aria-label="Center selected mirror links"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(true);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          ...mirrorProps,
          isRobotMirrorAvailabilityLoading: false,
          canAlignRobotMirrorOrientation: false,
          canFixRobotMirrorSymmetry: false,
        })
      );
    });

    expect(makeParallelButton?.disabled).toBe(true);
    expect(centerMirrorButton?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("reclassifies live plane-touching mirror links out of needs review", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          robotMirrorPlaneTouchingLinkNames: [
            "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-3",
            "drive_motor_mount-v11-1",
            "sensor_center",
          ],
          robotMirrorSelectionLinks: [
            {
              counterpartLinkName: null,
              groupKey: "standoff",
              groupLinkCount: 3,
              linkName: "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-3",
              meshLabel: "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff.stl",
              preselected: false,
              status: "review",
              defaultExclusionReason: null,
            },
            {
              counterpartLinkName: null,
              groupKey: "motor-mount",
              groupLinkCount: 3,
              linkName: "drive_motor_mount-v11-1",
              meshLabel: "drive_motor_mount-v11.stl",
              preselected: false,
              status: "review",
              defaultExclusionReason: null,
            },
            {
              counterpartLinkName: null,
              groupKey: "sensor",
              groupLinkCount: 1,
              linkName: "sensor_center",
              meshLabel: "sensor.stl",
              preselected: false,
              status: "available",
              defaultExclusionReason: null,
            },
          ],
          robotMirrorSymmetryCheck: {
            planeLabel: "xz",
            originMeters: [0, 0, 0],
            planeNormalWorld: [0, 1, 0],
            supportedGroupCount: 3,
            supportedLinkCount: 7,
            supportedLinkNames: [
              "arm_left",
              "arm_right",
              "ST3215_Servo_Motor-v1",
              "ST3215_Servo_Motor-v1-1",
              "ST3215_Servo_Motor-v1-2",
              "wheel_left",
              "wheel_right",
            ],
            totalRepeatedLinkCount: 13,
            centeredLinkCount: 1,
            centeredLinkNames: ["STS3215_03a-v1-4"],
            matchedPairCount: 3,
            averageResidualMeters: 0.0015,
            maxResidualMeters: 0.003,
            pairedGroupCount: 3,
            pairedLinkCount: 6,
            matchedPairs: [],
            reviewGroups: [
              {
                groupKey: "standoff",
                maxResidualMeters: null,
                meshLabel: "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff.stl",
                supportedLinkCount: 0,
                totalLinkCount: 3,
                unsupportedLinkNames: [
                  "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-3",
                  "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-4",
                  "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-5",
                ],
              },
              {
                groupKey: "motor-mount",
                maxResidualMeters: null,
                meshLabel: "drive_motor_mount-v11.stl",
                supportedLinkCount: 0,
                totalLinkCount: 3,
                unsupportedLinkNames: [
                  "drive_motor_mount-v11",
                  "drive_motor_mount-v11-1",
                  "drive_motor_mount-v11-2",
                ],
              },
            ],
            reviewLinkCount: 6,
          },
        })
      );
    });

    const mirrorSection = container.querySelector('[data-section="robot-mirror-symmetry"]');
    expect(mirrorSection).toBeTruthy();
    expect(getText(mirrorSection as ParentNode)).toContain("Mirror");
    expect(getText(mirrorSection as ParentNode)).not.toContain(
      "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff.stl"
    );

    const mirrorExpandButton = container.querySelector(
      'button[aria-label="Expand mirror controls"]'
    );
    await act(async () => {
      mirrorExpandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(getText(mirrorSection as ParentNode)).toContain(
      "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff.stl"
    );
    expect(getText(mirrorSection as ParentNode)).toContain("drive_motor_mount-v11.stl");
    const centeredStandoffLink = container
      .querySelector(
        '[aria-label="Select mirror link 94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-3"]'
      )
      ?.closest("label");
    const centeredMotorMountLink = container
      .querySelector('[aria-label="Select mirror link drive_motor_mount-v11-1"]')
      ?.closest("label");
    const centeredSensorLink = container
      .querySelector('[aria-label="Select mirror link sensor_center"]')
      ?.closest("label");
    expect(centeredStandoffLink).toBeTruthy();
    expect(centeredMotorMountLink).toBeTruthy();
    expect(centeredSensorLink).toBeTruthy();
    expect(getText(centeredStandoffLink as ParentNode)).not.toContain("review");
    expect(getText(centeredMotorMountLink as ParentNode)).not.toContain("review");
    expect(getText(centeredSensorLink as ParentNode)).not.toContain("review");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders compatibility robot mirror selection groups without crashing", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onFixRobotMirrorSymmetry = vi.fn();
    const onToggleRobotMirrorGroupSelection = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          onFixRobotMirrorSymmetry,
          onToggleRobotMirrorGroupSelection,
          robotMirrorSelectionGroups: [
            {
              groupKey: "group:arm",
              linkNames: ["arm_left", "arm_right"],
              meshLabel: "arm.stl",
            },
          ],
          selectedRobotMirrorGroupKeys: ["group:arm"],
          robotMirrorSymmetryCheck: {
            planeLabel: "xz",
            originMeters: [0, 0, 0],
            planeNormalWorld: [0, 1, 0],
            supportedGroupCount: 1,
            supportedLinkCount: 2,
            supportedLinkNames: ["arm_left", "arm_right"],
            totalRepeatedLinkCount: 2,
            centeredLinkCount: 0,
            centeredLinkNames: [],
            matchedPairCount: 1,
            averageResidualMeters: 0.001,
            maxResidualMeters: 0.002,
            pairedGroupCount: 1,
            pairedLinkCount: 2,
            matchedPairs: [],
            reviewGroups: [],
            reviewLinkCount: 0,
          },
        })
      );
    });

    const mirrorSection = container.querySelector('[data-section="robot-mirror-symmetry"]');
    expect(mirrorSection).toBeTruthy();
    expect(getText(mirrorSection as ParentNode)).toContain("2 selected");
    expect(getText(mirrorSection as ParentNode)).not.toContain("arm.stl");

    const mirrorExpandButton = container.querySelector(
      'button[aria-label="Expand mirror controls"]'
    );
    await act(async () => {
      mirrorExpandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(getText(mirrorSection as ParentNode)).toContain("arm.stl");

    const mirrorSelectionCheckbox = container.querySelector(
      'button[aria-label="Deselect mirror link arm_left"]'
    );
    await act(async () => {
      mirrorSelectionCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggleRobotMirrorGroupSelection).toHaveBeenCalledWith("group:arm");

    await act(async () => {
      root.unmount();
    });
  });

  it("marks high-error non-outlier symmetry branches as misaligned", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          repeatedInertiaSymmetryCenterMode: "robot-center",
          repeatedInertiaSymmetryChains: [
            {
              symmetryRootLinkName: "base_link",
              outlierBranchRootLinkName: "wheel_branch_rear",
              earliestDivergenceLinkName: "drive_motor_mount-v11-2",
              symmetryType: "radial",
              branchCount: 3,
              expectedAngleDegrees: 120,
              repeatedGroupCount: 4,
              repeatedMeshLabels: [
                "drive_motor_mount-v11.stl",
                "ST3215_Servo_Motor-v1.stl",
                "omni_wheel_mount-v5.stl",
                "4-Omni-Directional-Wheel_Single_Body-v1.stl",
              ],
              symmetryCenterMode: "robot-center",
              symmetryCenterPositionMeters: [0, 0, 0],
              rootMeshCenterPositionMeters: [0, 0, 0],
              siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
              maxAngularErrorDegrees: 14,
              maxDistanceDeltaMeters: 0.0195,
              outlierAngularErrorDegrees: 11.3,
              topologyMatchingBranchCount: 3,
              recommendedRepair: null,
              affectedLinkNames: [
                "drive_motor_mount-v11",
                "ST3215_Servo_Motor-v1",
                "omni_wheel_mount-v5",
                "4-Omni-Directional-Wheel_Single_Body-v1",
                "drive_motor_mount-v11-1",
                "ST3215_Servo_Motor-v1-1",
                "omni_wheel_mount-v5-1",
                "4-Omni-Directional-Wheel_Single_Body-v1-1",
                "drive_motor_mount-v11-2",
                "ST3215_Servo_Motor-v1-2",
                "omni_wheel_mount-v5-2",
                "4-Omni-Directional-Wheel_Single_Body-v1-2",
              ],
              branchLinkGroups: [
                {
                  branchRootLinkName: "wheel_branch_left",
                  linkNames: [
                    "drive_motor_mount-v11-1",
                    "ST3215_Servo_Motor-v1-1",
                    "omni_wheel_mount-v5-1",
                    "4-Omni-Directional-Wheel_Single_Body-v1-1",
                  ],
                  status: "aligned",
                },
                {
                  branchRootLinkName: "wheel_branch_right",
                  linkNames: [
                    "drive_motor_mount-v11",
                    "ST3215_Servo_Motor-v1",
                    "omni_wheel_mount-v5",
                    "4-Omni-Directional-Wheel_Single_Body-v1",
                  ],
                  status: "aligned",
                },
                {
                  branchRootLinkName: "wheel_branch_rear",
                  linkNames: [
                    "drive_motor_mount-v11-2",
                    "ST3215_Servo_Motor-v1-2",
                    "omni_wheel_mount-v5-2",
                    "4-Omni-Directional-Wheel_Single_Body-v1-2",
                  ],
                  status: "outlier",
                },
              ],
              branchRows: [
                {
                  branchRootLinkName: "wheel_branch_left",
                  representativeLinkName: "drive_motor_mount-v11-1",
                  radialDistanceMeters: 0.0825,
                  idealRadialDistanceMeters: 0.0825,
                  radialDistanceDeltaMeters: 0,
                  angleDegrees: 16,
                  idealAngleDegrees: 30,
                  idealPositionMeters: [0.0714470958, 0.04125, 0],
                  angularErrorDegrees: 14,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount-v11-1",
                      idealPositionMeters: [0.0714470958, 0.04125, 0],
                      idealLayerRadiusMeters: 0.0825,
                      lateralOffsetMeters: 0.02,
                      offsetDistanceMeters: 0.0202,
                      offsetVectorMeters: [0.0199, -0.0025, 0],
                      radialOffsetMeters: -0.0025,
                    },
                    {
                      linkName: "ST3215_Servo_Motor-v1-1",
                      idealPositionMeters: [0.089, 0.051, 0],
                      idealLayerRadiusMeters: 0.1025,
                      lateralOffsetMeters: 0.033,
                      offsetDistanceMeters: 0.0175,
                      offsetVectorMeters: [0.032, -0.008, 0],
                      radialOffsetMeters: -0.008,
                    },
                    {
                      linkName: "omni_wheel_mount-v5-1",
                      idealPositionMeters: [0.106, 0.061, 0],
                      idealLayerRadiusMeters: 0.1225,
                      lateralOffsetMeters: 0.0179,
                      offsetDistanceMeters: 0.0244,
                      offsetVectorMeters: [0.0178, -0.0016, 0],
                      radialOffsetMeters: -0.0016,
                    },
                    {
                      linkName: "4-Omni-Directional-Wheel_Single_Body-v1-1",
                      idealPositionMeters: [0.123, 0.071, 0],
                      idealLayerRadiusMeters: 0.1425,
                      lateralOffsetMeters: 0.0179,
                      offsetDistanceMeters: 0.0262,
                      offsetVectorMeters: [0.0178, -0.0015, 0],
                      radialOffsetMeters: -0.0015,
                    },
                  ],
                  lateralOffsetMeters: 0.02,
                  offsetDistanceMeters: 0.0202,
                  offsetVectorMeters: [0.0199, -0.0025, 0],
                  radialOffsetMeters: -0.0025,
                  status: "aligned",
                  rotationRadians: 0.2443460953,
                  topologyMatchesFamily: true,
                },
                {
                  branchRootLinkName: "wheel_branch_right",
                  representativeLinkName: "drive_motor_mount-v11",
                  radialDistanceMeters: 0.0825,
                  idealRadialDistanceMeters: 0.0825,
                  radialDistanceDeltaMeters: 0,
                  angleDegrees: 136,
                  idealAngleDegrees: 150,
                  idealPositionMeters: [-0.0714470958, 0.04125, 0],
                  angularErrorDegrees: 14,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount-v11",
                      idealPositionMeters: [-0.0714470958, 0.04125, 0],
                      idealLayerRadiusMeters: 0.0825,
                      lateralOffsetMeters: 0.02,
                      offsetDistanceMeters: 0.0202,
                      offsetVectorMeters: [-0.0199, -0.0025, 0],
                      radialOffsetMeters: -0.0025,
                    },
                  ],
                  lateralOffsetMeters: 0.02,
                  offsetDistanceMeters: 0.0202,
                  offsetVectorMeters: [-0.0199, -0.0025, 0],
                  radialOffsetMeters: -0.0025,
                  status: "aligned",
                  rotationRadians: 0.2443460953,
                  topologyMatchesFamily: true,
                },
                {
                  branchRootLinkName: "wheel_branch_rear",
                  representativeLinkName: "drive_motor_mount-v11-2",
                  radialDistanceMeters: 0.102,
                  idealRadialDistanceMeters: 0.0825,
                  radialDistanceDeltaMeters: 0.0195,
                  angleDegrees: 258.7,
                  idealAngleDegrees: 270,
                  idealPositionMeters: [0, -0.0825, 0],
                  angularErrorDegrees: 11.3,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount-v11-2",
                      idealPositionMeters: [0, -0.0825, 0],
                      idealLayerRadiusMeters: 0.0825,
                      lateralOffsetMeters: 0.02,
                      offsetDistanceMeters: 0.0266,
                      offsetVectorMeters: [-0.02, 0.0175, 0],
                      radialOffsetMeters: 0.0175,
                    },
                  ],
                  lateralOffsetMeters: 0.02,
                  offsetDistanceMeters: 0.0266,
                  offsetVectorMeters: [-0.02, 0.0175, 0],
                  radialOffsetMeters: 0.0175,
                  status: "outlier",
                  rotationRadians: 0.1972222055,
                  topologyMatchesFamily: true,
                },
              ],
            },
          ],
        })
      );
    });

    const symmetrySection = container.querySelector('[data-section="symmetry-chains"]');
    expect(symmetrySection).toBeTruthy();
    const radialExpandButton = container.querySelector(
      'button[aria-label="Expand radial symmetry controls"]'
    );
    expect(radialExpandButton).toBeTruthy();
    await act(async () => {
      radialExpandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const symmetryText = getText(symmetrySection as ParentNode);

    expect(symmetryText).toContain("16.0° → 30.0° (14.0° err)");
    expect(symmetryText).toContain("20.2 mm (rad -2.5 mm • lat 20.0 mm)");
    expect(symmetryText).toContain("Angle");
    expect(symmetryText).not.toContain(
      "16.0° → 30.0° (14.0° err)20.2 mm (rad -2.5 mm • lat 20.0 mm)Aligned"
    );
    expect(symmetryText).toContain("Outlier");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows a persisted symmetry verification message after auto-align", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          repeatedInertiaSymmetryCenterMode: "robot-center",
          onFixRepeatedInertiaSymmetryChain: vi.fn(),
          repeatedInertiaSymmetryOutcomeByChainKey: {
            [buildRepeatedInertiaSymmetryFamilyOutcomeKey({
              symmetryRootLinkName: "base_link",
              outlierBranchRootLinkName: "wheel_branch_rear",
              siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
            } as const)]: {
              completedProgress: {
                appliedStepCount: 1,
                totalStepCount: 1,
              },
              tone: "success",
              message: "Alignment applied. Keep the eye on to verify the result.",
            },
          },
          repeatedInertiaSymmetryChains: [
            {
              symmetryRootLinkName: "base_link",
              outlierBranchRootLinkName: "wheel_branch_rear",
              earliestDivergenceLinkName: "drive_motor_mount_rear",
              symmetryType: "radial",
              branchCount: 3,
              expectedAngleDegrees: 120,
              repeatedGroupCount: 1,
              repeatedMeshLabels: ["shared_wheel.stl"],
              symmetryCenterMode: "robot-center",
              symmetryCenterPositionMeters: [0, 0, 0],
              rootMeshCenterPositionMeters: [0, 0, 0],
              siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
              maxAngularErrorDegrees: 0.6,
              maxDistanceDeltaMeters: 0.0194,
              outlierAngularErrorDegrees: 0.6,
              topologyMatchingBranchCount: 3,
              recommendedRepair: null,
              affectedLinkNames: ["wheel_rear"],
              branchLinkGroups: [
                {
                  branchRootLinkName: "wheel_branch_rear",
                  linkNames: ["drive_motor_mount_rear", "wheel_rear"],
                  status: "outlier",
                },
              ],
              branchRows: [
                {
                  branchRootLinkName: "wheel_branch_rear",
                  representativeLinkName: "drive_motor_mount_rear",
                  radialDistanceMeters: 0.1019,
                  idealRadialDistanceMeters: 0.0825,
                  radialDistanceDeltaMeters: 0.0194,
                  angleDegrees: 271.8,
                  idealAngleDegrees: 270,
                  idealPositionMeters: [0, -0.0825, 0],
                  angularErrorDegrees: 0.6,
                  rotationRadians: -0.0314159265,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount_rear",
                      idealPositionMeters: [0, -0.0825, 0],
                      idealLayerRadiusMeters: 0.0825,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0.0194,
                      offsetVectorMeters: [0, 0.0194, 0],
                      radialOffsetMeters: 0.0194,
                    },
                  ],
                  lateralOffsetMeters: 0,
                  offsetDistanceMeters: 0.0194,
                  offsetVectorMeters: [0, 0.0194, 0],
                  radialOffsetMeters: 0.0194,
                  status: "outlier",
                  topologyMatchesFamily: true,
                },
              ],
            },
          ],
        })
      );
    });

    expect(getText(container)).toContain(
      "Symmetry Planes"
    );
    const symmetrySection = container.querySelector('[data-section="symmetry-chains"]');
    const radialExpandButton = container.querySelector(
      'button[aria-label="Expand radial symmetry controls"]'
    );
    expect(symmetrySection).toBeTruthy();
    expect(radialExpandButton).toBeTruthy();
    expect(getText(symmetrySection as ParentNode)).not.toContain(
      "Alignment applied. Keep the eye on to verify the result."
    );

    await act(async () => {
      radialExpandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getText(symmetrySection as ParentNode)).toContain(
      "Alignment applied. Keep the eye on to verify the result."
    );
    const completedAutoAlignButton = container.querySelector(
      'button[aria-label="Auto-align symmetry branch wheel_branch_rear"]'
    ) as HTMLButtonElement | null;
    expect(completedAutoAlignButton?.disabled).toBe(true);
    expect(completedAutoAlignButton?.textContent).toContain("Auto Align 1/1 joint move");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the persisted symmetry verification message when the same family re-detects with a new outlier branch", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          repeatedInertiaSymmetryCenterMode: "robot-center",
          onFixRepeatedInertiaSymmetryChain: vi.fn(),
          repeatedInertiaSymmetryOutcomeByChainKey: {
            [buildRepeatedInertiaSymmetryFamilyOutcomeKey({
              symmetryRootLinkName: "base_link",
              outlierBranchRootLinkName: "wheel_branch_rear",
              siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
            } as const)]: {
              completedProgress: {
                appliedStepCount: 1,
                totalStepCount: 1,
              },
              tone: "success",
              message: "Alignment applied. Keep the eye on to verify the result.",
            },
          },
          repeatedInertiaSymmetryChains: [
            {
              symmetryRootLinkName: "base_link",
              outlierBranchRootLinkName: "wheel_branch_left",
              earliestDivergenceLinkName: "drive_motor_mount_left",
              symmetryType: "radial",
              branchCount: 3,
              expectedAngleDegrees: 120,
              repeatedGroupCount: 1,
              repeatedMeshLabels: ["shared_wheel.stl"],
              symmetryCenterMode: "robot-center",
              symmetryCenterPositionMeters: [0, 0, 0],
              rootMeshCenterPositionMeters: [0, 0, 0],
              siblingBranchRootLinkNames: ["wheel_branch_rear", "wheel_branch_right"],
              maxAngularErrorDegrees: 0.6,
              maxDistanceDeltaMeters: 0.0194,
              outlierAngularErrorDegrees: 0.6,
              topologyMatchingBranchCount: 3,
              recommendedRepair: null,
              affectedLinkNames: ["wheel_left"],
              branchLinkGroups: [
                {
                  branchRootLinkName: "wheel_branch_left",
                  linkNames: ["drive_motor_mount_left", "wheel_left"],
                  status: "outlier",
                },
              ],
              branchRows: [
                {
                  branchRootLinkName: "wheel_branch_left",
                  representativeLinkName: "drive_motor_mount_left",
                  radialDistanceMeters: 0.1019,
                  idealRadialDistanceMeters: 0.0825,
                  radialDistanceDeltaMeters: 0.0194,
                  angleDegrees: 151.8,
                  idealAngleDegrees: 150,
                  idealPositionMeters: [-0.0714, 0.0412, 0],
                  angularErrorDegrees: 0.6,
                  rotationRadians: -0.0314159265,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount_left",
                      idealPositionMeters: [-0.0714, 0.0412, 0],
                      idealLayerRadiusMeters: 0.0825,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0.0194,
                      offsetVectorMeters: [0.0168, -0.0097, 0],
                      radialOffsetMeters: 0.0194,
                    },
                  ],
                  lateralOffsetMeters: 0,
                  offsetDistanceMeters: 0.0194,
                  offsetVectorMeters: [0.0168, -0.0097, 0],
                  radialOffsetMeters: 0.0194,
                  status: "outlier",
                  topologyMatchesFamily: true,
                },
              ],
            },
          ],
        })
      );
    });

    const symmetrySection = container.querySelector('[data-section="symmetry-chains"]');
    const radialExpandButton = container.querySelector(
      'button[aria-label="Expand radial symmetry controls"]'
    );
    expect(symmetrySection).toBeTruthy();
    expect(radialExpandButton).toBeTruthy();

    await act(async () => {
      radialExpandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getText(symmetrySection as ParentNode)).toContain(
      "Alignment applied. Keep the eye on to verify the result."
    );
    const completedAutoAlignButton = container.querySelector(
      'button[aria-label="Auto-align symmetry branch wheel_branch_left"]'
    ) as HTMLButtonElement | null;
    expect(completedAutoAlignButton?.disabled).toBe(true);
    expect(completedAutoAlignButton?.textContent).toContain("Auto Align 1/1 joint move");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows per-step progress in the radial auto-align button while a branch repair is running", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          repeatedInertiaSymmetryCenterMode: "robot-center",
          repeatedInertiaSymmetryActingChainKey: "base_link:wheel_branch_rear",
          repeatedInertiaSymmetryActingProgress: {
            chainKey: "base_link:wheel_branch_rear",
            appliedStepCount: 2,
            totalStepCount: 3,
          },
          onFixRepeatedInertiaSymmetryChain: vi.fn(),
          repeatedInertiaSymmetryChains: [
            {
              symmetryRootLinkName: "base_link",
              outlierBranchRootLinkName: "wheel_branch_rear",
              earliestDivergenceLinkName: "drive_motor_mount_rear",
              symmetryType: "radial",
              branchCount: 3,
              expectedAngleDegrees: 120,
              repeatedGroupCount: 1,
              repeatedMeshLabels: ["shared_wheel.stl"],
              symmetryCenterMode: "robot-center",
              symmetryCenterPositionMeters: [0, 0, 0],
              rootMeshCenterPositionMeters: [0, 0, 0],
              siblingBranchRootLinkNames: ["wheel_branch_left", "wheel_branch_right"],
              maxAngularErrorDegrees: 4.5,
              maxDistanceDeltaMeters: 0.012,
              outlierAngularErrorDegrees: 4.5,
              topologyMatchingBranchCount: 3,
              recommendedRepair: {
                kind: "translation",
                mode: "multi-joint",
                summary: "Adjust 3 joints to restore radial alignment.",
                targetLinkNames: ["drive_motor_mount_rear", "servo_motor_rear", "wheel_rear"],
                blockedTargetLinkNames: [],
                articulatedBoundaryJointName: null,
                stepCount: 3,
                steps: [
                  {
                    jointName: "joint_1",
                    childLinkName: "drive_motor_mount_rear",
                    parentLinkName: "base_link",
                    targetPositionMeters: [0.08, 0, 0],
                  },
                  {
                    jointName: "joint_2",
                    childLinkName: "servo_motor_rear",
                    parentLinkName: "drive_motor_mount_rear",
                    targetPositionMeters: [0.1, 0, 0],
                  },
                  {
                    jointName: "joint_3",
                    childLinkName: "wheel_rear",
                    parentLinkName: "servo_motor_rear",
                    targetPositionMeters: [0.12, 0, 0],
                  },
                ],
              },
              affectedLinkNames: ["wheel_rear"],
              branchLinkGroups: [
                {
                  branchRootLinkName: "wheel_branch_rear",
                  linkNames: ["drive_motor_mount_rear", "servo_motor_rear", "wheel_rear"],
                  status: "outlier",
                },
              ],
              branchRows: [
                {
                  branchRootLinkName: "wheel_branch_rear",
                  representativeLinkName: "drive_motor_mount_rear",
                  radialDistanceMeters: 0.094,
                  idealRadialDistanceMeters: 0.082,
                  radialDistanceDeltaMeters: 0.012,
                  angleDegrees: 266,
                  idealAngleDegrees: 270,
                  idealPositionMeters: [0, -0.082, 0],
                  angularErrorDegrees: 4,
                  rotationRadians: -0.0698131701,
                  linkRows: [
                    {
                      linkName: "drive_motor_mount_rear",
                      idealPositionMeters: [0, -0.082, 0],
                      idealLayerRadiusMeters: 0.082,
                      lateralOffsetMeters: 0,
                      offsetDistanceMeters: 0.012,
                      offsetVectorMeters: [0, 0.012, 0],
                      radialOffsetMeters: 0.012,
                    },
                  ],
                  lateralOffsetMeters: 0,
                  offsetDistanceMeters: 0.012,
                  offsetVectorMeters: [0, 0.012, 0],
                  radialOffsetMeters: 0.012,
                  status: "outlier",
                  topologyMatchesFamily: true,
                },
              ],
            },
          ],
        })
      );
    });

    const symmetryFixButton = container.querySelector(
      'button[aria-label="Auto-align symmetry branch wheel_branch_rear"]'
    );
    expect(symmetryFixButton?.textContent).toContain("Auto Align 2/3 joint moves");
    expect(symmetryFixButton?.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("uses grouped-comparison copy for clean repeated mesh groups", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          repeatedInertiaDiagnostics: [
            {
              groupKey: "collision:shared_leg.stl:1 1 1",
              meshLabel: "shared_leg.stl",
              meshReference: "meshes/shared_leg.stl",
              source: "collision",
              instanceCount: 2,
              issueKeys: ["group-review"],
              issueSummary: ["Viewer confidence is high across repeated copies."],
              physicalMismatch: false,
              massRelativeSpread: 0,
              principalMomentRelativeSpread: 0,
              meshLocalComMaxSeparationMeters: 0,
              confidenceValues: ["high"],
              strategyValues: ["principal"],
              linkEntries: [
                {
                  linkName: "leg_left",
                  massKg: 1,
                  principalMomentsKgM2: [3, 2, 1],
                  meshLocalComMeters: [0, 0, 0],
                  confidence: "high",
                  strategy: "principal",
                  mismatchScore: 0.12,
                  mismatchBreakdown: { volume: 0.04, shape: 0.05, center: 0.03 },
                  centerOfMassOutsideReference: false,
                },
                {
                  linkName: "leg_right",
                  massKg: 1,
                  principalMomentsKgM2: [3, 2, 1],
                  meshLocalComMeters: [0, 0, 0],
                  confidence: "high",
                  strategy: "principal",
                  mismatchScore: 0.11,
                  mismatchBreakdown: { volume: 0.03, shape: 0.05, center: 0.03 },
                  centerOfMassOutsideReference: false,
                },
              ],
            },
          ],
        })
      );
    });

    expect(getText(container)).not.toContain("Repeated Links");
    expect(getText(container)).not.toContain("No Fix Needed");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows an explicit physics-review action immediately while the backend audit is still loading", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          physicsPreflightLoading: true,
          onOpenGeneratePhysicsDialog: vi.fn(),
        })
      );
    });

    const physicsButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Analyzing physics check")
    );
    expect(physicsButton).toBeTruthy();
    expect(physicsButton?.hasAttribute("disabled")).toBe(true);
    expect(getText(container)).toContain("Analyzing physics now");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps regularize visible but locked while recover is running", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onGenerateRegularizedPhysics = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          physicsAuditSummary: {
            totalLinkCount: 3,
            presentLinkCount: 3,
            validLinkCount: 3,
            missingLinkCount: 0,
            invalidLinkCount: 0,
            repairableLinkCount: 0,
            totalMassKg: 2.5,
          },
          physicsPlausibilitySummary: {
            verdict: "plausible",
            comparableLinkCount: 2,
            excludedLinks: [
              {
                linkName: "arm",
                reason: "degenerate-geometry",
                message: "arm was skipped",
                recoveryAction: "voxel",
                recoveryEligible: true,
                recoveryMessage: null,
                recoveryDisposition: "recover",
                diagnostics: {
                  bucket: "non-positive-definite",
                  eigenvalues: [-1e-4, 1e-4, 2e-4],
                  conditionNumber: null,
                  triangleInequalityGap: -5e-4,
                },
              },
              {
                linkName: "wheel",
                reason: "invalid-inertia",
                message: "wheel can be regularized",
                recoveryAction: "voxel",
                recoveryEligible: true,
                recoveryMessage: null,
                recoveryDisposition: "regularize",
                diagnostics: {
                  bucket: "near-miss",
                  eigenvalues: [1e-6, 2e-6, 3e-6],
                  conditionNumber: 3,
                  triangleInequalityGap: -1e-6,
                },
              },
            ],
            authoredMassKg: 2.5,
            lightEstimateMassKg: 2,
            heavyEstimateMassKg: 3,
            warning: null,
            offenders: [],
          },
          physicsActionStatusByKey: {
            "voxel-recovery": "running",
          },
          onGenerateVoxelPhysics: vi.fn(),
          onGenerateRegularizedPhysics,
          onGeneratePhysics: vi.fn(),
        })
      );
    });

    const recoverButton = container.querySelector('button[aria-label="Recover 1 skipped inertial link"]');
    const regularizeButton = container.querySelector('button[aria-label="Regularize 1 near-miss inertial link"]');

    expect(getText(container)).toContain("Recovering...");
    expect(recoverButton?.hasAttribute("disabled")).toBe(true);
    expect(regularizeButton?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector('button[aria-label="Standard physics material"]')).toBeNull();

    await act(async () => {
      regularizeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('button[aria-label="Standard physics material"]')).toBeNull();
    expect(onGenerateRegularizedPhysics).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("locks recover and regularize quick actions while another simulation-prep fix is running", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onGenerateVoxelPhysics = vi.fn();
    const onGenerateRegularizedPhysics = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          isSimulationPrepFixBusy: true,
          physicsAuditSummary: {
            totalLinkCount: 3,
            presentLinkCount: 3,
            validLinkCount: 3,
            missingLinkCount: 0,
            invalidLinkCount: 0,
            repairableLinkCount: 0,
            totalMassKg: 2.5,
          },
          physicsPlausibilitySummary: {
            verdict: "plausible",
            comparableLinkCount: 2,
            excludedLinks: [
              {
                linkName: "arm",
                reason: "degenerate-geometry",
                message: "arm was skipped",
                recoveryAction: "voxel",
                recoveryEligible: true,
                recoveryMessage: null,
                recoveryDisposition: "recover",
                diagnostics: {
                  bucket: "non-positive-definite",
                  eigenvalues: [-1e-4, 1e-4, 2e-4],
                  conditionNumber: null,
                  triangleInequalityGap: -5e-4,
                },
              },
              {
                linkName: "wheel",
                reason: "invalid-inertia",
                message: "wheel can be regularized",
                recoveryAction: "voxel",
                recoveryEligible: true,
                recoveryMessage: null,
                recoveryDisposition: "regularize",
                diagnostics: {
                  bucket: "near-miss",
                  eigenvalues: [1e-6, 2e-6, 3e-6],
                  conditionNumber: 3,
                  triangleInequalityGap: -1e-6,
                },
              },
            ],
            authoredMassKg: 2.5,
            lightEstimateMassKg: 2,
            heavyEstimateMassKg: 3,
            warning: null,
            offenders: [],
          },
          onGenerateVoxelPhysics,
          onGenerateRegularizedPhysics,
          onGeneratePhysics: vi.fn(),
        })
      );
    });

    const recoverButton = container.querySelector(
      'button[aria-label="Recover 1 skipped inertial link"]'
    ) as HTMLButtonElement | null;
    const regularizeButton = container.querySelector(
      'button[aria-label="Regularize 1 near-miss inertial link"]'
    ) as HTMLButtonElement | null;

    expect(recoverButton?.disabled).toBe(true);
    expect(regularizeButton?.disabled).toBe(true);
    expect(container.querySelector('button[aria-label="Standard physics material"]')).toBeNull();

    await act(async () => {
      recoverButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      regularizeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onGenerateVoxelPhysics).not.toHaveBeenCalled();
    expect(onGenerateRegularizedPhysics).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the broad recalculation actions exclusive while one is running", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          physicsAuditSummary: {
            totalLinkCount: 3,
            presentLinkCount: 3,
            validLinkCount: 1,
            missingLinkCount: 1,
            invalidLinkCount: 1,
            repairableLinkCount: 2,
            totalMassKg: 2.5,
          },
          physicsPlausibilitySummary: {
            verdict: "plausible",
            comparableLinkCount: 3,
            excludedLinks: [],
            authoredMassKg: 2.5,
            lightEstimateMassKg: 2,
            heavyEstimateMassKg: 3,
            warning: null,
            offenders: [],
          },
          physicsActionStatusByKey: {
            "repair-missing-invalid": "running",
          },
          onGeneratePhysics: vi.fn(),
        })
      );
    });

    const repairButton = container.querySelector(
      'button[aria-label="Recalculate 2 missing / invalid inertial links"]'
    );
    const materialButton = container.querySelector('button[aria-label="Standard physics material"]');

    expect(getText(container)).toContain("Recalculating...");
    expect(repairButton?.hasAttribute("disabled")).toBe(true);
    expect(materialButton).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("lets the explicit physics review action start the audit before any audit data exists", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onOpenGeneratePhysicsDialog = vi.fn();

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          onOpenGeneratePhysicsDialog,
        })
      );
    });

    const physicsButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Run physics check")
    );
    expect(physicsButton).toBeTruthy();
    expect(physicsButton?.hasAttribute("disabled")).toBe(false);
    expect(getText(container)).toContain("Run the physics check before repairing masses.");

    await act(async () => {
      physicsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenGeneratePhysicsDialog).toHaveBeenCalledTimes(1);
    expect(getText(container)).toContain("Run physics check");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not offer a recalculate-all action when the audit found nothing to repair", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "safe",
          statusLabel: "Simulation Ready",
          physicsAuditSummary: {
            totalLinkCount: 3,
            presentLinkCount: 3,
            validLinkCount: 3,
            missingLinkCount: 0,
            invalidLinkCount: 0,
            repairableLinkCount: 0,
            totalMassKg: 2.5,
          },
          physicsPlausibilitySummary: {
            verdict: "plausible",
            comparableLinkCount: 3,
            excludedLinks: [],
            authoredMassKg: 2.5,
            lightEstimateMassKg: 2,
            heavyEstimateMassKg: 3,
            warning: null,
            offenders: [],
          },
        })
      );
    });

    expect(getText(container)).toContain("Physics check complete. No repair action is needed.");
    expect(getText(container)).not.toContain("Recalculate all");
    expect(
      Array.from(container.querySelectorAll("button")).some((node) =>
        node.textContent?.includes("Physics check complete")
      )
    ).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("shows preparation loading instead of a completion message while physics check is still running", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(HealthActionPanel, {
          open: true,
          statusTone: "warning",
          statusLabel: "Physics Warning",
          physicsPreflightLoading: true,
          physicsAuditSummary: {
            totalLinkCount: 3,
            presentLinkCount: 3,
            validLinkCount: 3,
            missingLinkCount: 0,
            invalidLinkCount: 0,
            repairableLinkCount: 0,
            totalMassKg: 2.5,
          },
          physicsPlausibilitySummary: {
            verdict: "plausible",
            comparableLinkCount: 3,
            excludedLinks: [],
            authoredMassKg: 2.5,
            lightEstimateMassKg: 2,
            heavyEstimateMassKg: 3,
            warning: null,
            offenders: [],
          },
        })
      );
    });

    expect(getText(container)).toContain("Physics check running...");
    expect(getText(container)).not.toContain("Physics check complete. No repair action is needed.");
    expect(getText(container)).not.toContain("Recalculate all");

    await act(async () => {
      root.unmount();
    });
  });

});
