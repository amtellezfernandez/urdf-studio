import { requireIluModule } from "./resolveIluRequire.js";

// Studio-local node bridge over the published i-love-urdf entrypoints.
// Backend and tool scripts should import from here instead of encoding package subpaths directly.
export const urdfCoreNodeDomRuntime = requireIluModule("i-love-urdf/node-dom-runtime");
urdfCoreNodeDomRuntime.installNodeDomGlobals();
export const urdfCore = requireIluModule("i-love-urdf");
export const urdfCoreBundleMeshAssetsNode = requireIluModule("i-love-urdf/bundle-mesh-assets-node");
export const urdfCoreLoadSourceNode = requireIluModule("i-love-urdf/load-source-node");
export const urdfCoreLocal = requireIluModule("i-love-urdf/local");
export const urdfCoreUrdfNode = requireIluModule("i-love-urdf/urdf-node");
export const urdfCoreXacroNode = requireIluModule("i-love-urdf/xacro-node");
