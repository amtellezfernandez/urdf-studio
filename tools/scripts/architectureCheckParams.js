export const ARCHITECTURE_EXIT_CODES = {
  failure: 1,
};

export const ARCHITECTURE_LOC_POLICY = {
  globalCap: 1200,
  strictCap: 900,
  strictPrefixes: [
    "web/src/app/pages/",
    "web/src/features/layout/",
    "web/src/features/viewer/",
  ],
  allowlist: [
    ["web/src/features/viewer/Viewer3D.tsx", 6944],
    ["web/src/app/pages/Index.tsx", 3331],
    ["web/src/features/layout/JointListSidebar.tsx", 3630],
    ["web/src/features/layout/page/HealthActionPanel.tsx", 3328],
    ["web/src/features/layout/page/HealthActionPanel.test.tsx", 3082],
    ["web/src/features/urdf/inertia/inertialSynthesis.ts", 2102],
    ["web/src/features/locomotion/approach/approachNavigation.ts", 2093],
    ["web/src/features/layout/page/repeatedInertiaSymmetry.ts", 2076],
    ["web/src/features/viewer/roverApproachBeforeIkSolve.ts", 1826],
    ["web/src/features/viewer/components/WorldObjectEditHandles.tsx", 1729],
    ["web/src/features/urdf/github/githubRepo.test.ts", 1511],
    ["web/src/features/viewer/useIkSolver.ts", 1398],
    ["web/src/features/layout/JointControl.tsx", 1416],
    ["web/src/features/layout/page/robotMirrorSymmetryFix.ts", 1206],
    ["web/src/features/viewer/IKDragControls.tsx", 1101],
    ["web/src/features/layout/page/lekiwiSymmetry.probe.test.ts", 961],
  ],
};

export const ARCHITECTURE_REQUIRED_FILES = [];

export const ARCHITECTURE_TEXT_CONTRACTS = [
  {
    relativePath: "web/src/features/viewer/Viewer3D.tsx",
    requiredSubstrings: [
      {
        value: "createUrdfMeshLoadCallback(",
        message: "must use createUrdfMeshLoadCallback.",
      },
    ],
    forbiddenPatterns: [
      {
        pattern: /loader\.loadMeshCb\s*=\s*\(/,
        message: "must not assign inline loader.loadMeshCb callbacks.",
      },
    ],
  },
  {
    relativePath: "web/src/features/camera/CameraViewportPreview.tsx",
    requiredSubstrings: [
      {
        value: "createUrdfMeshLoadCallback(",
        message: "must use createUrdfMeshLoadCallback.",
      },
    ],
    forbiddenPatterns: [
      {
        pattern: /loader\.loadMeshCb\s*=\s*\(/,
        message: "must not assign inline loader.loadMeshCb callbacks.",
      },
    ],
  },
  {
    relativePath: "web/src/features/layout/page/ViewerHost.tsx",
    requiredSubstrings: [
      {
        value: "@/runtime_engine/rosviz/session/runtimeSelector",
        message: "must consume runtime selector from runtime_engine.",
      },
      {
        value: "@/studio_ui/rosviz/RosVizViewer",
        message: "must load RosViz viewer from studio_ui.",
      },
    ],
  },
  {
    relativePath: "web/src/features/layout/panels/RuntimeHealthPanel.tsx",
    requiredSubstrings: [
      {
        value: "@/studio_ui/panels/RuntimeHealthPanel",
        message: "must re-export RuntimeHealthPanel from studio_ui.",
      },
    ],
  },
  {
    relativePath: "web/src/studio_ui/panels/RuntimeHealthPanel.tsx",
    requiredSubstrings: [
      {
        value: "@/runtime_engine/rosviz/state/runtimeHealthStore",
        message: "must read runtime health state from runtime_engine.",
      },
    ],
  },
  {
    relativePath: "web/src/studio_ui/rosviz/RosVizViewer.tsx",
    requiredSubstrings: [
      {
        value: "@/runtime_engine/rosviz/state/runtimeHealthStore",
        message: "must read runtime health state from runtime_engine.",
      },
    ],
  },
];

export const ARCHITECTURE_RUNTIME_MESH_LOADER_EXPORT_CONTRACT = {
  relativePath: "web/src/features/urdf/runtime/urdfMeshLoader.ts",
  reexportSource: "@runtime-private/urdf/urdfMeshLoader",
  exportNames: [
    "loadMeshObjectForUrdfReference",
    "createUrdfMeshLoadCallback",
  ],
};
