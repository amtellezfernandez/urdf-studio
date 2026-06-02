import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createDefaultMeshMaterial,
  createMaterialFromPayload,
  isDefaultMeshMaterial,
  serializeMeshMaterial,
} from "@runtime-private/urdf/meshMaterialPayload";

describe("meshMaterialPayload", () => {
  it("round-trips imported material types through the shared payload", () => {
    const sourceMaterials: THREE.Material[] = [
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.4, 0.6), side: THREE.DoubleSide }),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(0.7, 0.2, 0.1) }),
      new THREE.MeshPhongMaterial({
        color: new THREE.Color(0.1, 0.8, 0.3),
        emissive: new THREE.Color(0.05, 0.06, 0.07),
        opacity: 0.8,
        transparent: true,
      }),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.9, 0.8, 0.2),
        emissive: new THREE.Color(0.02, 0.03, 0.04),
        metalness: 0.6,
        roughness: 0.25,
      }),
    ];

    sourceMaterials.forEach((sourceMaterial) => {
      const payload = serializeMeshMaterial(sourceMaterial);
      const restored = createMaterialFromPayload(payload, "high");
      const restoredMaterial = restored as THREE.MeshStandardMaterial;
      const sourceColor = (sourceMaterial as THREE.MeshStandardMaterial).color;
      const sourceEmissive = (sourceMaterial as THREE.MeshStandardMaterial).emissive;

      expect(payload).toBeDefined();
      expect(isDefaultMeshMaterial(restored)).toBe(false);
      expect(restored.side).toBe(sourceMaterial.side);
      expect(restoredMaterial.color.r).toBeCloseTo(sourceColor.r, 5);
      expect(restoredMaterial.color.g).toBeCloseTo(sourceColor.g, 5);
      expect(restoredMaterial.color.b).toBeCloseTo(sourceColor.b, 5);

      if (sourceEmissive) {
        expect(restoredMaterial.emissive.r).toBeCloseTo(sourceEmissive.r, 5);
        expect(restoredMaterial.emissive.g).toBeCloseTo(sourceEmissive.g, 5);
        expect(restoredMaterial.emissive.b).toBeCloseTo(sourceEmissive.b, 5);
      }
    });
  });

  it("marks only fallback materials as default", () => {
    const fallback = createDefaultMeshMaterial("low");
    const restored = createMaterialFromPayload(
      serializeMeshMaterial(new THREE.MeshPhongMaterial({ color: new THREE.Color(0.4, 0.5, 0.6) })),
      "low"
    );

    expect(isDefaultMeshMaterial(fallback)).toBe(true);
    expect(isDefaultMeshMaterial(restored)).toBe(false);
  });
});
