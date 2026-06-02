import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { ColladaExporter, ColladaLoader } from "three-stdlib";
import { resolveMeshBlobFromReference } from "@/shared/lib/urdfBrowser";
import type { UrdfBakedMeshPlan } from "./virtualBake";

export type MeshBakeUnsupportedReason =
  | "unsupported-format"
  | "unresolved-mesh-reference";

export type BakedMeshSidecar = {
  filename: string;
  blob: Blob;
};

export type BakedMeshOverride = {
  sourceReference: string;
  resolvedPath: string;
  outputFilename: string;
  blob: Blob;
  sidecars: BakedMeshSidecar[];
};

export type MeshBakePlanExecutionResult = {
  overrides: BakedMeshOverride[];
  unsupported: Array<{
    meshReference: string;
    reason: MeshBakeUnsupportedReason;
  }>;
};

const OBJ_EXTENSION = ".obj";
const STL_EXTENSION = ".stl";
const DAE_EXTENSION = ".dae";
const COLLADA_MIME_TYPE = "model/vnd.collada+xml";
const PLAIN_TEXT_MIME_TYPE = "text/plain";
const STL_MIME_TYPE = "model/stl";
const PNG_MIME_TYPE = "image/png";
const COLLADA_DEFAULT_TEXTURE_EXTENSION = "png";
const COLLADA_TEXTURE_FIELDS = ["map", "specularMap", "emissiveMap", "normalMap"] as const;

type MeshExportResult =
  | {
      kind: "blob";
      blob: Blob;
      sidecars: BakedMeshSidecar[];
    }
  | {
      kind: "unsupported";
      reason: MeshBakeUnsupportedReason;
    };

const getLowercasePath = (path: string): string => path.trim().toLowerCase();

const inferOutputFilename = (resolvedPath: string): string =>
  resolvedPath.split("/").pop() || resolvedPath;

const inferBaseFilename = (filename: string): string => {
  const lastDotIndex = filename.lastIndexOf(".");
  return lastDotIndex >= 0 ? filename.slice(0, lastDotIndex) : filename;
};

const namespaceColladaTextureNames = (
  object: THREE.Object3D,
  outputFilename: string
): void => {
  const outputBaseName = inferBaseFilename(outputFilename);
  let unnamedTextureCounter = 0;
  const renamedTextures = new WeakSet<THREE.Texture>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const materialValue = mesh.material;
    const materials = Array.isArray(materialValue) ? materialValue : materialValue ? [materialValue] : [];
    for (const material of materials) {
      for (const textureField of COLLADA_TEXTURE_FIELDS) {
        const texture = (material as THREE.MeshPhongMaterial & Record<string, unknown>)[
          textureField
        ] as THREE.Texture | null | undefined;
        if (!texture || renamedTextures.has(texture)) {
          continue;
        }
        const textureBaseName = texture.name.trim() || `texture_${unnamedTextureCounter + 1}`;
        if (!texture.name.trim()) {
          unnamedTextureCounter += 1;
        }
        texture.name = `${outputBaseName}_${textureBaseName}`;
        renamedTextures.add(texture);
      }
    }
  });
};

type ColladaExportTexture = {
  name: string;
  ext: string;
  data: Uint8Array;
};

const buildColladaTextureSidecars = (
  textures: unknown[]
): BakedMeshSidecar[] =>
  textures.flatMap((texture): BakedMeshSidecar[] => {
    const exportTexture = texture as Partial<ColladaExportTexture>;
    const textureName = exportTexture.name?.trim();
    const textureExt = exportTexture.ext?.trim() || COLLADA_DEFAULT_TEXTURE_EXTENSION;
    if (!textureName || !(exportTexture.data instanceof Uint8Array)) {
      return [];
    }
    return [
      {
        filename: `${textureName}.${textureExt}`,
        blob: new Blob([new Uint8Array(exportTexture.data)], { type: PNG_MIME_TYPE }),
      },
    ];
  });

const loadObjectFromBlob = async (blob: Blob, resolvedPath: string): Promise<THREE.Object3D | null> => {
  const normalizedPath = getLowercasePath(resolvedPath);
  if (normalizedPath.endsWith(OBJ_EXTENSION)) {
    const content = await blob.text();
    return new OBJLoader().parse(content);
  }
  if (normalizedPath.endsWith(DAE_EXTENSION)) {
    const content = await blob.text();
    return new ColladaLoader().parse(content, resolvedPath).scene;
  }
  if (normalizedPath.endsWith(STL_EXTENSION)) {
    const geometry = new STLLoader().parse(await blob.arrayBuffer());
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  }
  return null;
};

const exportObjectToBlob = (object: THREE.Object3D, resolvedPath: string): MeshExportResult => {
  const normalizedPath = getLowercasePath(resolvedPath);
  if (normalizedPath.endsWith(OBJ_EXTENSION)) {
    const content = new OBJExporter().parse(object);
    return {
      kind: "blob",
      blob: new Blob([content], { type: PLAIN_TEXT_MIME_TYPE }),
      sidecars: [],
    };
  }
  if (normalizedPath.endsWith(DAE_EXTENSION)) {
    const outputFilename = inferOutputFilename(resolvedPath);
    namespaceColladaTextureNames(object, outputFilename);
    const exportResult = new ColladaExporter().parse(object, () => undefined);
    if (!exportResult) {
      return {
        kind: "unsupported",
        reason: "unsupported-format",
      };
    }
    return {
      kind: "blob",
      blob: new Blob([exportResult.data], { type: COLLADA_MIME_TYPE }),
      sidecars: buildColladaTextureSidecars(exportResult.textures),
    };
  }
  if (normalizedPath.endsWith(STL_EXTENSION)) {
    const data = new STLExporter().parse(object, { binary: true }) as DataView;
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return {
      kind: "blob",
      blob: new Blob([bytes], { type: STL_MIME_TYPE }),
      sidecars: [],
    };
  }
  return {
    kind: "unsupported",
    reason: "unsupported-format",
  };
};

export const executeMeshBakePlan = async ({
  plan,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  plan: UrdfBakedMeshPlan;
  meshFiles: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}): Promise<MeshBakePlanExecutionResult> => {
  const overrides: BakedMeshOverride[] = [];
  const unsupported: MeshBakePlanExecutionResult["unsupported"] = [];

  for (const entry of plan.entries) {
    const resolvedMesh = resolveMeshBlobFromReference(
      entry.meshReference,
      meshFiles,
      urdfBasePath,
      packageRoots
    );
    if (!resolvedMesh) {
      unsupported.push({
        meshReference: entry.meshReference,
        reason: "unresolved-mesh-reference",
      });
      continue;
    }

    const object = await loadObjectFromBlob(resolvedMesh.blob, resolvedMesh.path);
    if (!object) {
      unsupported.push({
        meshReference: entry.meshReference,
        reason: "unsupported-format",
      });
      continue;
    }

    const bakeMatrix = new THREE.Matrix4().fromArray(entry.bakeMatrixElements);
    object.applyMatrix4(bakeMatrix);
    object.updateMatrixWorld(true);

    const exportResult = exportObjectToBlob(object, resolvedMesh.path);
    if (exportResult.kind !== "blob") {
      unsupported.push({
        meshReference: entry.meshReference,
        reason: exportResult.reason,
      });
      continue;
    }

    overrides.push({
      sourceReference: entry.meshReference,
      resolvedPath: resolvedMesh.path,
      outputFilename: inferOutputFilename(resolvedMesh.path),
      blob: exportResult.blob,
      sidecars: exportResult.sidecars,
    });
  }

  return {
    overrides,
    unsupported,
  };
};
