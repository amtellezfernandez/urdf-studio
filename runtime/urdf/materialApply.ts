import * as THREE from "three";
import { MATERIAL_APPLY_PARAMS } from "./materialApplyParams";
import {
  resolveSyntheticVisualRgba,
  type ParsedRgba,
} from "./materialPolicy";

const MATERIAL_PARAMS = MATERIAL_APPLY_PARAMS;
const DEFAULT_ALPHA = MATERIAL_PARAMS.defaultAlpha;
const RGB_COMPONENTS = MATERIAL_PARAMS.rgbComponentCount;
const RGBA_COMPONENTS = MATERIAL_PARAMS.rgbaComponentCount;

const namedMaterialRgbaCache = new WeakMap<Document, Map<string, ParsedRgba>>();

const disposeMaterial = (material: THREE.Material) => {
  Object.values(material).forEach((value) => {
    if ((value as THREE.Texture)?.isTexture) {
      (value as THREE.Texture).dispose();
    }
  });
  material.dispose();
};

const applyMaterialRecursively = (
  root: THREE.Object3D,
  material: THREE.Material | THREE.Material[],
  key?: string
) => {
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    if (key && mesh.userData.urdfMaterialKey === key) {
      return;
    }

    const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    previous.forEach((entry) => {
      if (entry) {
        disposeMaterial(entry);
      }
    });

    mesh.material = Array.isArray(material)
      ? material.map((mat) => mat.clone())
      : material.clone();
    if (key) {
      mesh.userData.urdfMaterialKey = key;
    }
  });
};

const parseRgba = (rgba: string): ParsedRgba | null => {
  const values = rgba.split(/\s+/).map((value) => Number(value));
  if (
    values.length < RGB_COMPONENTS ||
    values.length > RGBA_COMPONENTS ||
    values.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  return [
    values[0] ?? 1,
    values[1] ?? 1,
    values[2] ?? 1,
    values[3] ?? DEFAULT_ALPHA,
  ];
};

const createPhongMaterialFromRgba = (rgba: ParsedRgba): THREE.MeshPhongMaterial => {
  const [r, g, b, alpha] = rgba;
  const material = new THREE.MeshPhongMaterial();
  material.color.setRGB(r, g, b);
  material.opacity = alpha;
  material.transparent = alpha < DEFAULT_ALPHA;
  material.depthWrite = alpha >= DEFAULT_ALPHA;
  return material;
};

const getNamedMaterialRgbaMap = (document: Document): Map<string, ParsedRgba> => {
  const cached = namedMaterialRgbaCache.get(document);
  if (cached) {
    return cached;
  }

  const namedRgba = new Map<string, ParsedRgba>();
  const robotNode = document.querySelector("robot");
  if (robotNode) {
    Array.from(robotNode.children).forEach((child) => {
      if (child.nodeName.toLowerCase() !== "material") {
        return;
      }
      const name = child.getAttribute("name")?.trim().toLowerCase();
      const rgbaRaw = child.querySelector("color")?.getAttribute("rgba")?.trim();
      if (!name || !rgbaRaw) {
        return;
      }
      const rgba = parseRgba(rgbaRaw);
      if (!rgba) {
        return;
      }
      namedRgba.set(name, rgba);
    });
  }

  namedMaterialRgbaCache.set(document, namedRgba);
  return namedRgba;
};

const parseUrdfColorMaterial = (visualNode: Element): THREE.MeshPhongMaterial | null => {
  const materialNode = Array.from(visualNode.children).find(
    (child) => child.nodeName.toLowerCase() === "material"
  );
  const materialName = materialNode?.getAttribute("name")?.trim() ?? null;

  if (materialNode) {
    const colorNode = Array.from(materialNode.children).find(
      (child) => child.nodeName.toLowerCase() === "color"
    );
    const inlineRgba = colorNode?.getAttribute("rgba")?.trim();
    if (inlineRgba) {
      const parsed = parseRgba(inlineRgba);
      if (parsed) {
        return createPhongMaterialFromRgba(parsed);
      }
    }

    const materialNameKey = materialName?.toLowerCase();
    if (materialNameKey) {
      const namedRgba = getNamedMaterialRgbaMap(visualNode.ownerDocument).get(materialNameKey);
      if (namedRgba) {
        return createPhongMaterialFromRgba(namedRgba);
      }
    }
  }

  return createPhongMaterialFromRgba(resolveSyntheticVisualRgba(visualNode));
};

export const applyUrdfVisualMaterials = (root: THREE.Object3D) => {
  root.traverse((obj) => {
    const urdfNode = (obj as { urdfNode?: Element }).urdfNode;
    if (!urdfNode || urdfNode.nodeName.toLowerCase() !== "visual") {
      return;
    }

    const material = parseUrdfColorMaterial(urdfNode);
    if (!material) return;

    const key = `rgba:${material.color.r.toFixed(4)}:${material.color.g.toFixed(4)}:${material.color.b.toFixed(4)}:${material.opacity.toFixed(4)}`;
    applyMaterialRecursively(obj, material, key);
    material.dispose();
  });
};
