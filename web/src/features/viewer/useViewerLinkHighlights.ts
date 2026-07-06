import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import jointColors from "@/shared/joint_colors.json";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { useLinkHighlightStore } from "@/shared/store/useLinkHighlightStore";
import { createLinkObjectResolver } from "@/features/viewer/linkObjectResolver";
import { setEmissiveColor } from "@/features/viewer/viewer-helpers";
import { hexToThreeJsHex } from "@/features/viewer/viewer3dHelpers";

type HighlightOptions = {
  jointName?: string | null;
  colorOverride?: number;
};

type UseViewerLinkHighlightsParams = {
  robotRef: { current: URDFRobot | null };
  jointLimits?: JointLimits;
  selectedJoint?: string | null;
  selectedLink?: string | null;
};

type HighlightableMaterial = THREE.Material & {
  color?: {
    getHex?: () => number;
    setHex?: (value: number) => void;
  };
  userData: THREE.Material["userData"] & {
    isHighlighted?: boolean;
    originalColor?: number;
    originalMesh?: THREE.Mesh;
  };
};

const toMaterials = (material: THREE.Material | THREE.Material[]): THREE.Material[] =>
  Array.isArray(material) ? material : [material];

const isHighlightableMaterial = (material: THREE.Material): boolean =>
  "emissive" in material || "color" in material;

const resolveJointHighlightColor = (
  jointName: string | null,
  jointLimits: JointLimits | undefined,
  colorOverride: number | undefined
): number => {
  if (colorOverride !== undefined) {
    return colorOverride;
  }
  if (jointName && jointLimits) {
    const jointInfo = jointLimits[jointName];
    if (jointInfo?.type) {
      const jointType = jointInfo.type as keyof typeof jointColors;
      if (jointColors[jointType]) {
        return hexToThreeJsHex(jointColors[jointType]);
      }
    }
  }
  return hexToThreeJsHex(jointColors.light_gray);
};

const restoreHighlightedMesh = (mesh: THREE.Mesh): void => {
  toMaterials(mesh.material).forEach((material) => {
    setEmissiveColor(material, 0x000000);
    const colorMaterial = material as HighlightableMaterial;
    if (
      colorMaterial.color?.setHex &&
      typeof colorMaterial.userData.originalColor === "number"
    ) {
      colorMaterial.color.setHex(colorMaterial.userData.originalColor);
    }
  });
};

const ensureHighlightableMeshMaterials = (mesh: THREE.Mesh): THREE.Material[] | null => {
  const materials = toMaterials(mesh.material);
  if (!materials.some(isHighlightableMaterial)) {
    return null;
  }
  const needsClone = materials.some((material) => !material.userData.isHighlighted);
  if (!needsClone) {
    return toMaterials(mesh.material);
  }

  const clonedMaterials = materials.map((material) => material.clone());
  mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0];
  clonedMaterials.forEach((material) => {
    const colorMaterial = material as HighlightableMaterial;
    colorMaterial.userData.isHighlighted = true;
    colorMaterial.userData.originalMesh = mesh;
    if (colorMaterial.color?.getHex) {
      colorMaterial.userData.originalColor = colorMaterial.color.getHex();
    }
  });
  return clonedMaterials;
};

const applyMaterialHighlight = (material: THREE.Material, highlightColor: number): void => {
  if ("emissive" in material) {
    setEmissiveColor(material, highlightColor);
    return;
  }
  const colorMaterial = material as HighlightableMaterial;
  colorMaterial.color?.setHex?.(highlightColor);
};

export const useViewerLinkHighlights = ({
  robotRef,
  jointLimits,
  selectedJoint,
  selectedLink,
}: UseViewerLinkHighlightsParams) => {
  const highlightedMeshesRef = useRef<THREE.Mesh[]>([]);
  const highlightedLinks = useLinkHighlightStore((state) => state.highlightedLinks);

  const clearHighlights = useCallback(() => {
    highlightedMeshesRef.current.forEach(restoreHighlightedMesh);
    highlightedMeshesRef.current = [];
  }, []);

  const applyHighlightToLink = useCallback(
    (linkName: string, options?: HighlightOptions) => {
      const robot = robotRef.current;
      if (!robot) return;
      const resolveLinkObject = createLinkObjectResolver(robot);
      const link = resolveLinkObject(linkName);
      if (!link) return;

      const highlightColor = resolveJointHighlightColor(
        options?.jointName ?? null,
        jointLimits,
        options?.colorOverride
      );
      const allLinkNames = new Set(Object.keys(robot.links || {}));

      const traverseLinkOnly = (object: THREE.Object3D) => {
        if (object instanceof THREE.Mesh) {
          const activeMaterials = ensureHighlightableMeshMaterials(object);
          if (activeMaterials) {
            activeMaterials.forEach((material) =>
              applyMaterialHighlight(material, highlightColor)
            );
            highlightedMeshesRef.current.push(object);
          }
        }

        object.children.forEach((child) => {
          if (!allLinkNames.has(child.name)) {
            traverseLinkOnly(child);
          }
        });
      };

      traverseLinkOnly(link);
    },
    [jointLimits, robotRef]
  );

  const highlightLink = useCallback(
    (linkName: string, jointName?: string | null) => {
      clearHighlights();
      applyHighlightToLink(linkName, { jointName });
    },
    [applyHighlightToLink, clearHighlights]
  );

  const highlightLinks = useCallback(
    (linkNames: string[]) => {
      clearHighlights();
      const batchHighlightColor = hexToThreeJsHex(jointColors.light_gray);
      linkNames.forEach((linkName) => {
        applyHighlightToLink(linkName, {
          colorOverride: batchHighlightColor,
        });
      });
    },
    [applyHighlightToLink, clearHighlights]
  );

  const getLinkNameForJoint = useCallback(
    (jointName: string): string | null => {
      const robot = robotRef.current;
      if (!robot) return null;
      const joint = robot.joints?.[jointName];
      if (!joint) return null;
      const linkNames = new Set(Object.keys(robot.links || {}));
      for (const child of joint.children ?? []) {
        if (linkNames.has(child.name)) return child.name;
      }
      return null;
    },
    [robotRef]
  );

  useEffect(() => {
    const robot = robotRef.current;
    if (!robot) {
      clearHighlights();
      return;
    }
    if (highlightedLinks.length > 0) {
      highlightLinks(highlightedLinks);
    } else if (selectedJoint) {
      const linkName = getLinkNameForJoint(selectedJoint);
      if (linkName) highlightLink(linkName, selectedJoint);
    } else if (selectedLink) {
      highlightLink(selectedLink);
    } else {
      clearHighlights();
    }
  }, [
    clearHighlights,
    getLinkNameForJoint,
    highlightedLinks,
    highlightLink,
    highlightLinks,
    robotRef,
    selectedJoint,
    selectedLink,
  ]);

  return {
    highlightLink,
  };
};
