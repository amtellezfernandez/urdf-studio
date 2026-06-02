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
    ["web/src/features/layout/Sidebar.tsx", 7600],
    ["web/src/features/viewer/Viewer3D.tsx", 7620],
    ["web/src/features/dataset/EpisodeViewer3DModal.tsx", 5200],
    ["web/src/features/dataset/FolderUploadScreen.tsx", 5102],
    ["web/src/features/teleop/panel/OperatorTeleopPanel.tsx", 4447],
    ["web/src/app/pages/Index.tsx", 3694],
    ["web/src/features/layout/JointListSidebar.tsx", 3747],
    ["web/src/features/teleop/panel/OperatorTeleopPanel.test.ts", 3485],
    ["web/src/features/layout/page/HealthActionPanel.tsx", 3348],
    ["web/src/features/layout/page/HealthActionPanel.test.tsx", 3082],
    ["web/src/features/teleop/transport/operatorHelperApi.ts", 2191],
    ["web/src/features/urdf/inertia/inertialSynthesis.ts", 2102],
    ["web/src/features/locomotion/approach/approachNavigation.ts", 2093],
    ["web/src/features/urdf/github/githubRepo.ts", 2100],
    ["web/src/features/layout/page/repeatedInertiaSymmetry.ts", 2076],
    ["web/src/features/layout/sidebar/useHfDatasetImportController.ts", 1920],
    ["web/src/features/dataset/JointMappingDialog.tsx", 1800],
    ["web/src/features/viewer/roverApproachBeforeIkSolve.ts", 1826],
    ["web/src/features/viewer/components/WorldObjectEditHandles.tsx", 1729],
    ["web/src/features/dataset/ExportDialog.tsx", 1500],
    ["web/src/features/urdf/github/githubRepo.test.ts", 1511],
    ["web/src/features/dataset/FolderUploadRobotLoader.tsx", 1474],
    ["web/src/features/viewer/useIkSolver.ts", 1430],
    ["web/src/features/layout/JointControl.tsx", 1423],
    ["web/src/features/layout/sidebar/sidebarHelpers.ts", 1400],
    ["web/src/features/layout/panels/EpisodesPanel.tsx", 1316],
    ["web/src/features/layout/page/robotMirrorSymmetryFix.ts", 1210],
    ["web/src/features/viewer/IKDragControls.tsx", 1103],
    ["web/src/features/layout/page/lekiwiSymmetry.probe.test.ts", 961],
    ["web/src/features/layout/sidebar/useLocalDatasetImportController.ts", 947],
  ],
};

export const ARCHITECTURE_REQUIRED_FILES = [
  "web/src/studio_core/index.ts",
  "web/src/runtime_engine/index.ts",
  "web/src/studio_ui/index.ts",
];

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
    relativePath: "web/src/features/camera/EpisodeCameraPreview.tsx",
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
        value: "@/studio_ui/rosviz/RosVizV2Viewer",
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
    relativePath: "web/src/studio_ui/rosviz/RosVizV2Viewer.tsx",
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
