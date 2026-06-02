import { requireIluModule } from "./resolveIluRequire.js";

// Studio-local node bridge over the published i-love-urdf entrypoints.
// Backend and tool scripts should import from here instead of encoding package subpaths directly.
export const urdfCore = requireIluModule("i-love-urdf");
export const urdfCoreLoadSourceNode = requireIluModule("i-love-urdf/load-source-node");
export const urdfCoreLocal = requireIluModule("i-love-urdf/local");
export const urdfCoreUrdfNode = requireIluModule("i-love-urdf/urdf-node");
export const urdfCoreXacroNode = requireIluModule("i-love-urdf/xacro-node");
