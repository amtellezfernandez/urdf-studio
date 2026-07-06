import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import type { MeshFiles } from "@/shared/types/feature";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import type { CollisionEntry, UrdfAnalysis } from "@/shared/lib/urdfCore";
import { resolveMeshBlobFromReference } from "@/shared/lib/urdfBrowser";
import {
  disposeMeshResources,
  loadMeshFromBlob,
} from "@/features/urdf/mesh/meshDecode";
import { useLinkHighlightStore } from "@/shared/store/useLinkHighlightStore";
import {
  hasRenderableCollisionEntries,
  isCollisionEntryVisible,
} from "@/features/viewer/collisionVisibility";
import { createLinkObjectResolver } from "@/features/viewer/linkObjectResolver";
import {
  composeUrdfPoseMatrix,
  composeWorldMatrixFromLinkAndLocal,
  URDF_CYLINDER_TO_THREE_AXIS_QUATERNION,
} from "@/shared/lib/spatialFrame";
import { markAndCheckDuplicateCollisionEntry } from "@/features/viewer/collisionEntryDedup";
import {
  buildMeshCollisionPoseSet,
  shouldSkipPrimitiveCollisionWhenMeshOverlaps,
} from "@/features/viewer/collisionEntryFiltering";
import {
  configureCollisionOverlayInstancedMesh,
  configureCollisionOverlayMesh,
  createCollisionOverlayMaterial,
} from "@/features/viewer/collisionGeometryRenderHelpers";

type CollisionInstance = {
  linkName: string;
  localMatrix: THREE.Matrix4;
};

type CollisionPrimitiveInstanceRef = MutableRefObject<CollisionInstance[]>;
type CollisionProxyTarget = "simplified" | "merged";

const UNIT_BOX_HALF_EXTENT = 0.5;
const UNIT_BOX_CORNERS: readonly THREE.Vector3[] = [
  new THREE.Vector3(
    -UNIT_BOX_HALF_EXTENT,
    -UNIT_BOX_HALF_EXTENT,
    -UNIT_BOX_HALF_EXTENT,
  ),
  new THREE.Vector3(
    UNIT_BOX_HALF_EXTENT,
    -UNIT_BOX_HALF_EXTENT,
    -UNIT_BOX_HALF_EXTENT,
  ),
  new THREE.Vector3(
    -UNIT_BOX_HALF_EXTENT,
    UNIT_BOX_HALF_EXTENT,
    -UNIT_BOX_HALF_EXTENT,
  ),
  new THREE.Vector3(
    UNIT_BOX_HALF_EXTENT,
    UNIT_BOX_HALF_EXTENT,
    -UNIT_BOX_HALF_EXTENT,
  ),
  new THREE.Vector3(
    -UNIT_BOX_HALF_EXTENT,
    -UNIT_BOX_HALF_EXTENT,
    UNIT_BOX_HALF_EXTENT,
  ),
  new THREE.Vector3(
    UNIT_BOX_HALF_EXTENT,
    -UNIT_BOX_HALF_EXTENT,
    UNIT_BOX_HALF_EXTENT,
  ),
  new THREE.Vector3(
    -UNIT_BOX_HALF_EXTENT,
    UNIT_BOX_HALF_EXTENT,
    UNIT_BOX_HALF_EXTENT,
  ),
  new THREE.Vector3(
    UNIT_BOX_HALF_EXTENT,
    UNIT_BOX_HALF_EXTENT,
    UNIT_BOX_HALF_EXTENT,
  ),
];

export const CollisionGeometries = ({
  urdfAnalysis,
  meshFiles,
  urdfBasePath,
  packageRoots,
  collisionVisibility,
  collisionSimplifyLinks = [],
  collisionMergedLinks = [],
  robot,
  gpuMode = "high",
}: {
  urdfAnalysis: UrdfAnalysis | null;
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  collisionVisibility: CollisionVisibility;
  collisionSimplifyLinks?: string[];
  collisionMergedLinks?: string[];
  robot: URDFRobot | null;
  gpuMode?: GPUMode;
}) => {
  const collisionGroupRef = useRef<THREE.Group>(null);
  const dynamicGroupRef = useRef<THREE.Group>(null);
  const meshAbortRef = useRef<AbortController | null>(null);
  const collisionMeshesRef = useRef<
    Map<
      string,
      {
        object: THREE.Object3D;
        linkName: string;
        localMatrix: THREE.Matrix4;
      }
    >
  >(new Map());
  const boxInstancesRef = useRef<CollisionInstance[]>([]);
  const sphereInstancesRef = useRef<CollisionInstance[]>([]);
  const cylinderInstancesRef = useRef<CollisionInstance[]>([]);
  const boxMeshRef = useRef<THREE.InstancedMesh>(null);
  const sphereMeshRef = useRef<THREE.InstancedMesh>(null);
  const cylinderMeshRef = useRef<THREE.InstancedMesh>(null);
  const mergedBoxMeshRef = useRef<THREE.Mesh>(null);
  const simplifiedBoundsCacheRef = useRef(new Map<string, THREE.Box3>());
  const lastMeshFilesRef = useRef<MeshFiles | null>(null);
  const mergedInstancesRef = useRef<CollisionInstance[]>([]);
  const mergedBoundsRef = useRef(new THREE.Box3());
  const mergedBoundsSizeRef = useRef(new THREE.Vector3());
  const mergedBoundsCenterRef = useRef(new THREE.Vector3());
  const mergedCornerRef = useRef(new THREE.Vector3());
  const mergedWorldMatrixRef = useRef(new THREE.Matrix4());
  const proxyBoundsSizeRef = useRef(new THREE.Vector3());
  const proxyBoundsCenterRef = useRef(new THREE.Vector3());
  const proxyMeshScaleRef = useRef(new THREE.Vector3());
  const [boxCount, setBoxCount] = useState(0);
  const [sphereCount, setSphereCount] = useState(0);
  const [cylinderCount, setCylinderCount] = useState(0);
  const tempMatrix = useRef(new THREE.Matrix4());
  const tempPosition = useRef(new THREE.Vector3());
  const tempQuaternion = useRef(new THREE.Quaternion());
  const tempScale = useRef(new THREE.Vector3());
  const isLowGPU = gpuMode === "low";
  const simplifiedLinksSet = useMemo(
    () => new Set(collisionSimplifyLinks),
    [collisionSimplifyLinks],
  );
  const highlightedLinks = useLinkHighlightStore(
    (state) => state.highlightedLinks,
  );
  const highlightedLinksSet = useMemo(
    () => new Set(highlightedLinks),
    [highlightedLinks],
  );
  const mergedLinksSet = useMemo(
    () => new Set(collisionMergedLinks),
    [collisionMergedLinks],
  );
  const resolveLinkObject = useMemo(
    () => createLinkObjectResolver(robot),
    [robot],
  );
  const applyCollisionObjectTransform = useCallback(
    (
      object: THREE.Object3D,
      linkName: string,
      localMatrix: THREE.Matrix4,
      fallbackToLocal = false,
    ) => {
      const linkObject = resolveLinkObject(linkName);
      const worldMatrix = tempMatrix.current;

      if (linkObject) {
        composeWorldMatrixFromLinkAndLocal(
          linkObject.matrixWorld,
          localMatrix,
          worldMatrix,
        );
      } else if (fallbackToLocal) {
        worldMatrix.copy(localMatrix);
      } else {
        return false;
      }

      worldMatrix.decompose(
        tempPosition.current,
        tempQuaternion.current,
        tempScale.current,
      );
      object.position.copy(tempPosition.current);
      object.quaternion.copy(tempQuaternion.current);
      object.scale.copy(tempScale.current);
      return true;
    },
    [resolveLinkObject],
  );
  const sphereSegments = isLowGPU ? 12 : 24;
  const cylinderSegments = isLowGPU ? 12 : 24;
  const baseCollisionMaterial = useMemo(
    () => createCollisionOverlayMaterial(isLowGPU),
    [isLowGPU],
  );
  const boxGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const sphereGeometry = useMemo(
    () => new THREE.SphereGeometry(1, sphereSegments, sphereSegments),
    [sphereSegments],
  );
  const cylinderGeometry = useMemo(
    () => new THREE.CylinderGeometry(1, 1, 1, cylinderSegments),
    [cylinderSegments],
  );

  useEffect(
    () => () => baseCollisionMaterial.dispose(),
    [baseCollisionMaterial],
  );
  useEffect(() => () => boxGeometry.dispose(), [boxGeometry]);
  useEffect(() => () => sphereGeometry.dispose(), [sphereGeometry]);
  useEffect(() => () => cylinderGeometry.dispose(), [cylinderGeometry]);
  useEffect(() => {
    if (lastMeshFilesRef.current === meshFiles) return;
    simplifiedBoundsCacheRef.current.clear();
    lastMeshFilesRef.current = meshFiles;
  }, [meshFiles]);

  useEffect(() => {
    if (boxMeshRef.current) {
      configureCollisionOverlayInstancedMesh(boxMeshRef.current);
    }
    if (sphereMeshRef.current) {
      configureCollisionOverlayInstancedMesh(sphereMeshRef.current);
    }
    if (cylinderMeshRef.current) {
      configureCollisionOverlayInstancedMesh(cylinderMeshRef.current);
    }
    if (mergedBoxMeshRef.current) {
      configureCollisionOverlayMesh(mergedBoxMeshRef.current);
      mergedBoxMeshRef.current.visible = false;
    }
  }, [boxCount, sphereCount, cylinderCount]);

  // Parse and render collision geometries
  useEffect(() => {
    if (
      !urdfAnalysis?.isValid ||
      !collisionGroupRef.current ||
      !dynamicGroupRef.current ||
      !robot
    ) {
      return;
    }

    const hasVisible = hasRenderableCollisionEntries(
      urdfAnalysis.collisionsByLink,
      collisionVisibility,
    );

    // Clear existing collision geometries (dynamic mesh objects only)
    collisionMeshesRef.current.forEach(({ object }) => {
      disposeMeshResources(object);
      dynamicGroupRef.current?.remove(object);
    });
    collisionMeshesRef.current.clear();

    while (dynamicGroupRef.current.children.length > 0) {
      const child = dynamicGroupRef.current.children[0];
      if (child.userData?.isCollisionGeometry) {
        disposeMeshResources(child);
      }
      dynamicGroupRef.current.remove(child);
    }

    boxInstancesRef.current = [];
    sphereInstancesRef.current = [];
    cylinderInstancesRef.current = [];
    mergedInstancesRef.current = [];
    if (mergedBoxMeshRef.current) {
      mergedBoxMeshRef.current.visible = false;
    }
    setBoxCount(0);
    setSphereCount(0);
    setCylinderCount(0);

    if (!hasVisible) {
      return;
    }

    const abortController = new AbortController();
    meshAbortRef.current?.abort();
    meshAbortRef.current = abortController;

    try {
      // Update robot matrix world to get current link positions
      const robotObject = robot;
      robotObject?.updateMatrixWorld(true);

      // Helper function to apply link transformation to mesh
      const applyCollisionMaterial = (object: THREE.Object3D) => {
        object.traverse((child) => {
          if (!(child as THREE.Mesh).isMesh) return;
          const mesh = child as THREE.Mesh;
          const material = baseCollisionMaterial.clone();
          mesh.material = material;
          configureCollisionOverlayMesh(mesh);
        });
      };

      const buildLocalMatrix = (
        xyz: [number, number, number],
        rpy: [number, number, number],
        scale?: [number, number, number],
        extraRotation?: THREE.Quaternion,
        centerOffset?: THREE.Vector3,
      ) =>
        composeUrdfPoseMatrix(
          {
            xyz,
            rpy,
            scale,
            extraRotation,
            centerOffset,
          },
          new THREE.Matrix4(),
        );
      const syncPrimitiveCounts = () => {
        setBoxCount(boxInstancesRef.current.length);
        setSphereCount(sphereInstancesRef.current.length);
        setCylinderCount(cylinderInstancesRef.current.length);
      };

      const proxyTargetRefs: Record<
        CollisionProxyTarget,
        CollisionPrimitiveInstanceRef
      > = {
        simplified: boxInstancesRef,
        merged: mergedInstancesRef,
      };

      const addMeshProxyFromBounds = (options: {
        target: CollisionProxyTarget;
        bounds: THREE.Box3;
        meshScale: [number, number, number];
        collision: CollisionEntry;
        linkName: string;
      }) => {
        const { target, bounds, meshScale, collision, linkName } = options;
        if (bounds.isEmpty()) return;
        const size = proxyBoundsSizeRef.current;
        const center = proxyBoundsCenterRef.current;
        const scale = proxyMeshScaleRef.current.set(
          meshScale[0],
          meshScale[1],
          meshScale[2],
        );
        bounds.getSize(size);
        bounds.getCenter(center);
        size.multiply(scale);
        center.multiply(scale);
        const localMatrix = buildLocalMatrix(
          collision.origin.xyz,
          collision.origin.rpy,
          [size.x, size.y, size.z],
          undefined,
          center,
        );
        proxyTargetRefs[target].current.push({ linkName, localMatrix });
        if (target === "simplified") {
          syncPrimitiveCounts();
        }
      };

      const loadCollisionObject = (options: {
        blob: Blob;
        path: string;
        filename: string;
        errorLabel: string;
        onLoad: (object: THREE.Object3D) => void;
      }) => {
        const { blob, path, filename, errorLabel, onLoad } = options;
        loadMeshFromBlob({
          blob,
          path,
          gpuMode,
          meshFiles,
          signal: abortController.signal,
        })
          .then((result) => {
            if (!result?.object || abortController.signal.aborted) {
              if (result?.object) {
                disposeMeshResources(result.object);
              }
              return;
            }
            onLoad(result.object);
          })
          .catch((err) => {
            if (!abortController.signal.aborted) {
              console.error(`Error loading ${errorLabel} ${filename}:`, err);
            }
          });
      };

      const collisionsByLink = urdfAnalysis.collisionsByLink;
      Object.entries(collisionsByLink).forEach(([linkName, collisions]) => {
        if (highlightedLinksSet.has(linkName)) {
          return;
        }
        const seenCollisionEntries = new Set<string>();
        const visibleUniqueCollisions: CollisionEntry[] = [];
        collisions.forEach((collision: CollisionEntry) => {
          const { index } = collision;
          const isVisible = isCollisionEntryVisible(
            collisionVisibility,
            linkName,
            index,
          );
          if (!isVisible) return;
          if (
            markAndCheckDuplicateCollisionEntry(seenCollisionEntries, collision)
          )
            return;
          visibleUniqueCollisions.push(collision);
        });

        const meshPoseSet = buildMeshCollisionPoseSet(visibleUniqueCollisions);
        visibleUniqueCollisions.forEach((collision) => {
          if (
            shouldSkipPrimitiveCollisionWhenMeshOverlaps(collision, meshPoseSet)
          )
            return;

          const geometry = collision.geometry;
          const shouldMerge = mergedLinksSet.has(linkName);

          if (geometry.type === "box") {
            const localMatrix = buildLocalMatrix(
              collision.origin.xyz,
              collision.origin.rpy,
              geometry.size,
            );
            if (shouldMerge) {
              mergedInstancesRef.current.push({ linkName, localMatrix });
              return;
            }
            boxInstancesRef.current.push({ linkName, localMatrix });
            return;
          }

          if (geometry.type === "sphere") {
            const localMatrix = buildLocalMatrix(
              collision.origin.xyz,
              collision.origin.rpy,
              shouldMerge
                ? [
                    geometry.radius * 2,
                    geometry.radius * 2,
                    geometry.radius * 2,
                  ]
                : [geometry.radius, geometry.radius, geometry.radius],
            );
            if (shouldMerge) {
              mergedInstancesRef.current.push({ linkName, localMatrix });
              return;
            }
            sphereInstancesRef.current.push({ linkName, localMatrix });
            return;
          }

          if (geometry.type === "cylinder") {
            const localMatrix = buildLocalMatrix(
              collision.origin.xyz,
              collision.origin.rpy,
              shouldMerge
                ? [geometry.radius * 2, geometry.length, geometry.radius * 2]
                : [geometry.radius, geometry.length, geometry.radius],
              URDF_CYLINDER_TO_THREE_AXIS_QUATERNION,
            );
            if (shouldMerge) {
              mergedInstancesRef.current.push({ linkName, localMatrix });
              return;
            }
            cylinderInstancesRef.current.push({ linkName, localMatrix });
            return;
          }

          if (geometry.type === "mesh") {
            const filename = geometry.filename;
            const resolved = resolveMeshBlobFromReference(
              filename,
              meshFiles,
              urdfBasePath,
              packageRoots,
            );

            if (!resolved) {
              return;
            }

            const shouldSimplify = simplifiedLinksSet.has(linkName);
            if (shouldMerge || shouldSimplify) {
              const boundsCacheKey = `${resolved.path}:${resolved.blob.size}`;
              const cachedBounds =
                simplifiedBoundsCacheRef.current.get(boundsCacheKey);
              const proxyTarget: CollisionProxyTarget = shouldMerge
                ? "merged"
                : "simplified";
              const addCurrentProxyFromBounds = (bounds: THREE.Box3) => {
                addMeshProxyFromBounds({
                  target: proxyTarget,
                  bounds,
                  meshScale: geometry.scale,
                  collision,
                  linkName,
                });
              };
              if (cachedBounds) {
                addCurrentProxyFromBounds(cachedBounds);
                return;
              }
              loadCollisionObject({
                blob: resolved.blob,
                path: resolved.path,
                filename,
                errorLabel: "collision proxy mesh",
                onLoad: (object) => {
                  const bounds = new THREE.Box3().setFromObject(object);
                  disposeMeshResources(object);
                  if (bounds.isEmpty()) return;
                  simplifiedBoundsCacheRef.current.set(boundsCacheKey, bounds);
                  addCurrentProxyFromBounds(bounds);
                },
              });
              return;
            }

            loadCollisionObject({
              blob: resolved.blob,
              path: resolved.path,
              filename,
              errorLabel: "collision mesh",
              onLoad: (loadedObject) => {
                applyCollisionMaterial(loadedObject);
                const localMatrix = buildLocalMatrix(
                  collision.origin.xyz,
                  collision.origin.rpy,
                  geometry.scale,
                );
                applyCollisionObjectTransform(
                  loadedObject,
                  linkName,
                  localMatrix,
                  true,
                );
                loadedObject.userData.isCollisionGeometry = true;
                loadedObject.userData.linkName = linkName;
                loadedObject.userData.isCollisionGeom = true;
                loadedObject.userData.isCollision = true;
                dynamicGroupRef.current?.add(loadedObject);

                const meshKey = `${linkName}_${collision.index}`;
                collisionMeshesRef.current.set(meshKey, {
                  object: loadedObject,
                  linkName,
                  localMatrix,
                });
              },
            });

            return;
          }
        });
      });

      syncPrimitiveCounts();
    } catch (error) {
      console.error("Error rendering collision geometries:", error);
    }
    return () => {
      abortController.abort();
    };
  }, [
    urdfAnalysis,
    collisionVisibility,
    robot,
    gpuMode,
    meshFiles,
    urdfBasePath,
    packageRoots,
    simplifiedLinksSet,
    highlightedLinksSet,
    mergedLinksSet,
    baseCollisionMaterial,
    boxGeometry,
    sphereGeometry,
    cylinderGeometry,
    applyCollisionObjectTransform,
  ]);

  // Update collision geometry transforms every frame to follow robot movement
  useFrame(() => {
    if (!collisionGroupRef.current || !robot) return;
    const hasMeshes = collisionMeshesRef.current.size > 0;
    const hasInstances =
      boxInstancesRef.current.length > 0 ||
      sphereInstancesRef.current.length > 0 ||
      cylinderInstancesRef.current.length > 0;
    const hasMergedInstances = mergedInstancesRef.current.length > 0;
    const mergedMesh = mergedBoxMeshRef.current;
    if (!hasMeshes && !hasInstances && !hasMergedInstances) {
      if (mergedMesh) {
        mergedMesh.visible = false;
      }
      return;
    }

    const robotObject = robot;
    robotObject.updateMatrixWorld?.(true);

    // Update each collision mesh transform based on its link's current world position
    collisionMeshesRef.current.forEach(({ object, linkName, localMatrix }) => {
      applyCollisionObjectTransform(object, linkName, localMatrix);
    });

    const updateInstances = (
      instances: CollisionInstance[],
      meshRef: { current: THREE.InstancedMesh | null },
    ) => {
      const instanced = meshRef.current;
      if (!instanced || instances.length === 0) return;
      instances.forEach((entry, index) => {
        const linkObject = resolveLinkObject(entry.linkName);
        if (!linkObject) return;
        composeWorldMatrixFromLinkAndLocal(
          linkObject.matrixWorld,
          entry.localMatrix,
          tempMatrix.current,
        );
        instanced.setMatrixAt(index, tempMatrix.current);
      });
      instanced.instanceMatrix.needsUpdate = true;
    };

    updateInstances(boxInstancesRef.current, boxMeshRef);
    updateInstances(sphereInstancesRef.current, sphereMeshRef);
    updateInstances(cylinderInstancesRef.current, cylinderMeshRef);

    if (!mergedMesh) {
      return;
    }

    if (!hasMergedInstances) {
      mergedMesh.visible = false;
      return;
    }

    const mergedBounds = mergedBoundsRef.current;
    mergedBounds.makeEmpty();
    let hasMergedPoint = false;
    mergedInstancesRef.current.forEach((entry) => {
      const linkObject = resolveLinkObject(entry.linkName);
      if (!linkObject) return;
      composeWorldMatrixFromLinkAndLocal(
        linkObject.matrixWorld,
        entry.localMatrix,
        mergedWorldMatrixRef.current,
      );
      UNIT_BOX_CORNERS.forEach((unitCorner) => {
        mergedCornerRef.current
          .copy(unitCorner)
          .applyMatrix4(mergedWorldMatrixRef.current);
        mergedBounds.expandByPoint(mergedCornerRef.current);
        hasMergedPoint = true;
      });
    });

    if (!hasMergedPoint || mergedBounds.isEmpty()) {
      mergedMesh.visible = false;
      return;
    }

    mergedBounds.getCenter(mergedBoundsCenterRef.current);
    mergedBounds.getSize(mergedBoundsSizeRef.current);
    mergedMesh.visible = true;
    mergedMesh.position.copy(mergedBoundsCenterRef.current);
    mergedMesh.quaternion.identity();
    mergedMesh.scale.copy(mergedBoundsSizeRef.current);
  });

  return (
    <group ref={collisionGroupRef} renderOrder={999}>
      <group ref={dynamicGroupRef} />
      {boxCount > 0 && (
        <instancedMesh
          ref={boxMeshRef}
          args={[boxGeometry, baseCollisionMaterial, boxCount]}
        />
      )}
      {sphereCount > 0 && (
        <instancedMesh
          ref={sphereMeshRef}
          args={[sphereGeometry, baseCollisionMaterial, sphereCount]}
        />
      )}
      {cylinderCount > 0 && (
        <instancedMesh
          ref={cylinderMeshRef}
          args={[cylinderGeometry, baseCollisionMaterial, cylinderCount]}
        />
      )}
      <mesh
        ref={mergedBoxMeshRef}
        geometry={boxGeometry}
        material={baseCollisionMaterial}
        visible={false}
      />
    </group>
  );
};
