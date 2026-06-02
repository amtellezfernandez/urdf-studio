import {
  buildPackageRootsFromRepositoryFiles,
  resolveRepositoryFileReference,
  type RepositoryFileEntry,
} from "@/shared/lib/urdfCore";
import { buildMeshFolderAliasReferences } from "@runtime-private/urdf/meshReferenceFallbacks";

export const filterActionableUnmatchedMeshReferences = (
  candidatePath: string,
  unmatchedMeshReferences: string[],
  repositoryFiles: RepositoryFileEntry[]
): string[] => {
  if (unmatchedMeshReferences.length === 0 || repositoryFiles.length === 0) {
    return unmatchedMeshReferences;
  }

  const packageRoots = buildPackageRootsFromRepositoryFiles(repositoryFiles);
  return unmatchedMeshReferences.filter(
    (meshReference) =>
      ![meshReference, ...buildMeshFolderAliasReferences(meshReference)].some((candidateReference) =>
        Boolean(
          resolveRepositoryFileReference(candidatePath, candidateReference, repositoryFiles, {
            packageRoots,
          })
        )
      )
  );
};
