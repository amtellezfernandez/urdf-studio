import { useEffect, useState } from "react";
import type { MeshFiles } from "@/features/types";

export const useMeshFilesState = (initialMeshFiles: MeshFiles) => {
  const [meshFiles, setMeshFiles] = useState<MeshFiles>(initialMeshFiles);

  useEffect(() => {
    if (Object.keys(initialMeshFiles).length > 0) {
      setMeshFiles(initialMeshFiles);
    }
  }, [initialMeshFiles]);

  return { meshFiles, setMeshFiles };
};
