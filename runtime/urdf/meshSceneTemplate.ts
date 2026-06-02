import * as THREE from "three";

const TEXTURE_SLOTS = [
  "alphaMap",
  "aoMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "iridescenceMap",
  "lightMap",
  "map",
  "matcap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "specularMap",
  "thicknessMap",
  "transmissionMap",
] as const;

const materialHasTextureMaps = (material: THREE.Material) => {
  const candidate = material as THREE.Material & Record<string, unknown>;
  return TEXTURE_SLOTS.some((slot) => {
    const value = candidate[slot];
    return Boolean((value as THREE.Texture | undefined)?.isTexture);
  });
};

const cloneOwnedTexture = (texture: THREE.Texture) => {
  const clone = texture.clone();
  clone.needsUpdate = true;
  return clone;
};

const cloneOwnedMaterial = (material: THREE.Material) => {
  const clone = material.clone();
  const source = material as THREE.Material & Record<string, unknown>;
  const target = clone as THREE.Material & Record<string, unknown>;

  TEXTURE_SLOTS.forEach((slot) => {
    const value = source[slot];
    if ((value as THREE.Texture | undefined)?.isTexture) {
      target[slot] = cloneOwnedTexture(value as THREE.Texture);
    }
  });

  return clone;
};

const cloneOwnedObject = (source: THREE.Object3D): THREE.Object3D => {
  const cloned = source.clone(false);

  if ((source as THREE.Mesh).isMesh) {
    const sourceMesh = source as THREE.Mesh;
    const clonedMesh = cloned as THREE.Mesh;
    clonedMesh.geometry = sourceMesh.geometry?.clone() ?? null;
    clonedMesh.material = Array.isArray(sourceMesh.material)
      ? sourceMesh.material.map((material) => cloneOwnedMaterial(material))
      : cloneOwnedMaterial(sourceMesh.material);
  }

  source.children.forEach((child) => {
    cloned.add(cloneOwnedObject(child));
  });

  return cloned;
};

export const sceneNeedsTemplatePreservation = (root: THREE.Object3D) => {
  let needsTemplate = false;

  root.traverse((obj) => {
    if (needsTemplate || !(obj as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = obj as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
    if (materials.length > 1) {
      needsTemplate = true;
      return;
    }

    if (materials.some((material) => materialHasTextureMaps(material))) {
      needsTemplate = true;
    }
  });

  return needsTemplate;
};

export const cloneOwnedSceneTemplate = (source: THREE.Object3D) => cloneOwnedObject(source);
