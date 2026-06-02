import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { createServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const iLoveUrdfNodeDomRuntimeUrl = pathToFileURL(
  path.resolve(repoRoot, "..", "i-love-urdf", "dist", "node", "nodeDomRuntime.js")
).href;

const { installNodeDomGlobals } = await import(iLoveUrdfNodeDomRuntimeUrl);

const readStdin = async () =>
  await new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", reject);
  });

const decodeMeshFiles = (meshFiles) => {
  const result = {};
  for (const file of meshFiles ?? []) {
    if (!file || typeof file.path !== "string" || typeof file.base64Content !== "string") {
      continue;
    }
    const bytes = Buffer.from(file.base64Content, "base64");
    result[file.path] = new Blob([bytes], {
      type: typeof file.mimeType === "string" ? file.mimeType : "",
    });
  }
  return result;
};

const payload = JSON.parse(await readStdin());
installNodeDomGlobals();

const viteServer = await createServer({
  configFile: path.resolve(repoRoot, "config", "vite.config.ts"),
  mode: "test",
  logLevel: "error",
  appType: "custom",
  server: {
    middlewareMode: true,
  },
});

try {
  const module = await viteServer.ssrLoadModule("/src/features/urdf/inertia/robotMasteringBackend.ts");
  const sharedInput = {
    sourceUrdf: payload.sourceUrdf,
    urdfBasePath: payload.urdfBasePath,
    packageRoots: payload.packageRoots ?? {},
    meshFiles: decodeMeshFiles(payload.meshFiles),
  };
  const result =
    payload.operation === "bake-export-execute"
      ? await module.runBakeExportExecute({
          planEntries: payload.planEntries ?? [],
          planConflicts: payload.planConflicts ?? [],
          meshFiles: decodeMeshFiles(payload.meshFiles),
          urdfBasePath: payload.urdfBasePath,
          packageRoots: payload.packageRoots ?? {},
        })
      : payload.operation === "canonical-synthesis"
      ? await module.runCanonicalSynthesis({
          sourceUrdf: payload.sourceUrdf,
          synthesisSourceUrdf: payload.synthesisSourceUrdf,
          robotName: payload.robotName ?? null,
          capturedLinkWorldPoses: payload.capturedLinkWorldPoses ?? [],
          supportPlane: payload.supportPlane,
        })
      : payload.operation === "frame-preflight"
      ? await module.runFramePreflight({
          sourceUrdf: payload.sourceUrdf,
        })
      : payload.operation === "generate-physics-preflight"
      ? await module.runGeneratePhysicsPreflight(sharedInput)
      : await module.runGeneratePhysicsMastering({
          ...sharedInput,
          densityPresetId: payload.densityPresetId,
          repairMode: payload.repairMode,
          linkNames: Array.isArray(payload.linkNames) ? payload.linkNames : [],
          meshSolveMode:
            payload.meshSolveMode === "voxel-only" ? "voxel-only" : "surface-then-voxel",
          regularizeNearMissTensors: payload.regularizeNearMissTensors === true,
          canonicalizeRepeatedMeshes: payload.canonicalizeRepeatedMeshes === true,
        });
  process.stdout.write(JSON.stringify(result));
} finally {
  await viteServer.close();
}
