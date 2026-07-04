import type { DebugMeshInfo } from "@/shared/types/feature";

type FormatUrdfMeshLoadDiagnosticsParams = {
  debugMeshInfo: readonly DebugMeshInfo[];
  loadedMeshAssetCount: number;
  totalPathVariationCount: number;
  unmatchedRefCount: number;
  urdfMeshReferenceCount: number;
};

export const formatUrdfMeshLoadDiagnostics = ({
  debugMeshInfo,
  loadedMeshAssetCount,
  totalPathVariationCount,
  unmatchedRefCount,
  urdfMeshReferenceCount,
}: FormatUrdfMeshLoadDiagnosticsParams): string[] => {
  const matchedReferenceCount = debugMeshInfo.filter((meshInfo) => meshInfo.found).length;
  const lines = [
    `Loaded ${loadedMeshAssetCount} mesh files with ${totalPathVariationCount} total path variations`,
    `URDF references: ${urdfMeshReferenceCount} total, ${matchedReferenceCount} matched, ${unmatchedRefCount} unmatched`,
  ];

  debugMeshInfo.forEach((info) => {
    const meshLabel = `${info.filename} (${info.webkitRelativePath})`;
    lines.push(`  ${meshLabel}: ${info.registeredPaths.length} path variations`);
    lines.push(`    Primary: ${info.registeredPaths[0] || "N/A"}`);
    if (info.registeredPaths.length > 1) {
      lines.push(
        `    Others: ${info.registeredPaths.slice(1, 10).join(", ")}${
          info.registeredPaths.length > 10 ? "..." : ""
        }`
      );
    }
  });

  return lines;
};
