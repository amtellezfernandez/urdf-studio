export const INDEX_PAGE_HELPER_PARAMS = {
  defaultWorldScenePackageId: "urdf-studio-world",
  defaultWorldScenePackageTitle: "URDF Studio Shared World",
  worldScenePackageImportAccept: ".json,.world-package.json",
  worldLayoutLocalImportAccept:
    ".json,application/json,.stl,.dae,.obj,.glb,.gltf,.mtl,.ply,.splat,.png,.jpg,.jpeg",
  defaultWorldLayoutExportName: "shared-world-layout",
  importWorldSceneUrlParam: "importWorldScenePackageUrl",
  importWorldSceneIdParam: "importWorldScenePackageId",
  importWorldSceneVersionParam: "importWorldScenePackageVersion",
  importWorldUrlParam: "importWorldPackageUrl",
  importWorldIdParam: "importWorldPackageId",
  importWorldVersionParam: "importWorldPackageVersion",
  importWorldLayoutUrlParam: "importWorldLayoutUrl",
  recentWorldLayoutLinksStorageKey: "urdf-studio-recent-world-layout-links",
  maxRecentWorldLayoutLinks: 6,
} as const;
