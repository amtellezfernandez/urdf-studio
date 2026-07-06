import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { URDFRobot } from "urdf-loader";
import type { LinkData } from "@/shared/lib/urdfBrowser";
import type { MeshFiles } from "@/shared/types/feature";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import {
  extractLinkInertialsFromLinkData,
  type LinkInertial,
} from "./computeCenterOfMass";
import {
  computeReliableInertiaBox,
  type InertiaBox,
  type InertiaVisualizationConfidence,
  type ReliableInertiaBox,
  type ReliableInertiaStrategy,
} from "./inertialMath";
import {
  composeUrdfPoseMatrix,
  composeWorldMatrixFromLinkAndLocal,
} from "@/shared/lib/spatialFrame";
import { createLinkObjectResolver } from "@/features/viewer/linkObjectResolver";
import {
  INERTIA_BOX_OPACITY,
  INERTIA_CENTER_MARKER_BASE_SIZE_METERS,
  INERTIA_CENTER_MARKER_COLOR,
  INERTIA_CENTER_MARKER_OPACITY,
  INERTIA_CENTER_OFFSET_LINE_RADIAL_SEGMENTS,
  INERTIA_CENTER_OFFSET_MIN_LENGTH_METERS,
  INERTIA_DEEMPHASIZED_OUTLINE_COLOR,
  INERTIA_DEEMPHASIZED_OUTLINE_OPACITY,
  INERTIA_GLOBAL_COM_SIZE_METERS,
  INERTIA_LINK_COM_SIZE_METERS,
  INERTIA_REFERENCE_BOX_COLOR,
  INERTIA_REFERENCE_BOX_OPACITY,
  INERTIA_SHAPE_FILL_COLOR_HEALTHY,
  INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
  INERTIA_SHAPE_FILL_COLOR_UNVERIFIED,
  INERTIA_SHAPE_FILL_COLOR_WARNING,
  INERTIA_VOLUME_EDGE_OPACITY,
  INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
  INERTIA_VOLUME_EDGE_COLOR_PROBLEMATIC,
  INERTIA_VOLUME_EDGE_COLOR_UNVERIFIED,
  INERTIA_VOLUME_EDGE_COLOR_WARNING,
} from "@/features/viewer/inertialVisualizationParams";
import {
  buildLinkCollisionGeometryReferences,
  type LinkCollisionGeometryReference,
  type GeometryReferenceSource,
} from "@/features/viewer/inertiaGeometryReference";
import { resolveInertiaCenterMarkerScale } from "@/features/viewer/inertialVisualizationColor";
import {
  buildInertiaVisualizationMetricGroups,
  buildInertiaVisualizationVisibleLinkIndices,
} from "@/features/viewer/inertialVisualizationGroups";

export type InertiaReliabilityEntry = {
  linkName: string;
  strategy: ReliableInertiaStrategy;
  confidence: InertiaVisualizationConfidence;
  referenceSource?: GeometryReferenceSource;
  mismatchScore?: number;
  mismatchBreakdown?: {
    volume: number;
    shape: number;
    center: number;
  };
  centerOfMassOutsideReference?: boolean;
};

type InertialVisualizationProps = {
  robot: URDFRobot | null;
  linkDataByName: Record<string, LinkData> | null;
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  jointValues?: Record<string, number>;
  showGlobal?: boolean;
  showLinkCom?: boolean;
  showInertia?: boolean;
  showReferenceGeometry?: boolean;
  scopedLinkNames?: string[] | null;
  deemphasizedOutlineLinkNames?: string[] | null;
  globalSize?: number;
  linkSize?: number;
  inertiaOpacity?: number;
  gpuMode?: GPUMode;
  onReliabilityChange?: (entries: InertiaReliabilityEntry[]) => void;
};

const COM_COLOR = 0xff6fae;

const createCrossGeometry = (size: number) => {
  const g = new THREE.BufferGeometry();
  const s = size * 2;
  const points = new Float32Array([
    -s,
    0,
    0,
    s,
    0,
    0,
    0,
    -s,
    0,
    0,
    s,
    0,
    0,
    0,
    -s,
    0,
    0,
    s,
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(points, 3));
  return g;
};

export const InertialVisualization = ({
  robot,
  linkDataByName,
  meshFiles,
  urdfBasePath,
  packageRoots,
  jointValues: _jointValues,
  showGlobal = true,
  showLinkCom = false,
  showInertia = false,
  showReferenceGeometry = false,
  scopedLinkNames = null,
  deemphasizedOutlineLinkNames = null,
  globalSize = INERTIA_GLOBAL_COM_SIZE_METERS,
  linkSize = INERTIA_LINK_COM_SIZE_METERS,
  inertiaOpacity = INERTIA_BOX_OPACITY,
  gpuMode = "high",
  onReliabilityChange,
}: InertialVisualizationProps) => {
  void _jointValues;
  const resolveLinkObject = useMemo(
    () => createLinkObjectResolver(robot),
    [robot],
  );
  const [geometryReferencesByLink, setGeometryReferencesByLink] = useState<
    Map<string, LinkCollisionGeometryReference>
  >(() => new Map());

  useEffect(() => {
    let cancelled = false;

    if (!linkDataByName) {
      setGeometryReferencesByLink(new Map());
      return () => {
        cancelled = true;
      };
    }

    buildLinkCollisionGeometryReferences({
      linkDataByName,
      meshFiles,
      urdfBasePath,
      packageRoots,
    })
      .then((references) => {
        if (!cancelled) {
          setGeometryReferencesByLink(references);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGeometryReferencesByLink(new Map());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [linkDataByName, meshFiles, packageRoots, urdfBasePath]);

  const inertials = useMemo<LinkInertial[]>(() => {
    if (!linkDataByName) return [];
    return extractLinkInertialsFromLinkData(linkDataByName);
  }, [linkDataByName]);

  const inertiaByIndex = useMemo(() => {
    const map = new Map<number, ReliableInertiaBox>();
    inertials.forEach((item, index) => {
      const geometryReference =
        geometryReferencesByLink.get(item.linkName) ?? null;
      const box = computeReliableInertiaBox({
        inertia: item.inertia,
        mass: item.mass,
        inertialOrigin: item.origin,
        inertialRpy: item.rpy,
        geometryReference,
      });
      if (box) {
        map.set(index, box);
      }
    });
    return map;
  }, [geometryReferencesByLink, inertials]);

  const reliabilityEntries = useMemo<InertiaReliabilityEntry[]>(() => {
    const entries: InertiaReliabilityEntry[] = [];
    inertials.forEach((item, index) => {
      const box = inertiaByIndex.get(index);
      if (!box) return;
      entries.push({
        linkName: item.linkName,
        strategy: box.strategy,
        confidence: box.confidence,
        referenceSource: box.referenceSource,
        mismatchScore: box.mismatchScore,
        mismatchBreakdown: box.mismatchBreakdown,
        centerOfMassOutsideReference: box.centerOfMassOutsideReference,
      });
    });
    return entries;
  }, [inertials, inertiaByIndex]);
  const inertiaIndices = useMemo(
    () => Array.from(inertiaByIndex.keys()),
    [inertiaByIndex],
  );
  const {
    visibleLinkIndices,
    activeVisibleLinkIndices,
    deemphasizedVisibleLinkIndices,
  } = useMemo(
    () =>
      buildInertiaVisualizationVisibleLinkIndices({
        inertiaIndices,
        inertials,
        scopedLinkNames,
        deemphasizedOutlineLinkNames,
      }),
    [deemphasizedOutlineLinkNames, inertiaIndices, inertials, scopedLinkNames],
  );
  const shapeGroups = useMemo(
    () =>
      buildInertiaVisualizationMetricGroups({
        inertiaIndices: activeVisibleLinkIndices,
        inertiaByIndex,
        metric: "shape",
      }),
    [activeVisibleLinkIndices, inertiaByIndex],
  );
  const volumeGroups = useMemo(
    () =>
      buildInertiaVisualizationMetricGroups({
        inertiaIndices: activeVisibleLinkIndices,
        inertiaByIndex,
        metric: "volume",
      }),
    [activeVisibleLinkIndices, inertiaByIndex],
  );
  const referenceIndices = useMemo(
    () =>
      activeVisibleLinkIndices.filter((index) =>
        Boolean(inertiaByIndex.get(index)?.referenceBox),
      ),
    [activeVisibleLinkIndices, inertiaByIndex],
  );

  const globalRef = useRef<THREE.Group>(null);
  const linkComRef = useRef<THREE.InstancedMesh>(null);
  const inertiaFillRefs = useRef<Record<string, THREE.InstancedMesh | null>>({
    healthy: null,
    warning: null,
    problematic: null,
    unverified: null,
  });
  const inertiaEdgeRefs = useRef<Record<string, THREE.InstancedMesh | null>>({
    healthy: null,
    warning: null,
    problematic: null,
    unverified: null,
  });
  const centerMarkerRef = useRef<THREE.InstancedMesh>(null);
  const referenceRef = useRef<THREE.InstancedMesh>(null);
  const deemphasizedOutlineRef = useRef<THREE.InstancedMesh>(null);
  const transformCache = useRef<
    Array<{ position: THREE.Vector3; inertialWorldMatrix: THREE.Matrix4 }>
  >([]);

  const inertialMatrix = useRef(new THREE.Matrix4());
  const inertialWorldMatrix = useRef(new THREE.Matrix4());
  const tempMatrix = useRef(new THREE.Matrix4());
  const inertiaLocalBoxMatrix = useRef(new THREE.Matrix4());
  const inertiaBoxCenter = useRef(new THREE.Vector3());
  const inertiaBoxSize = useRef(new THREE.Vector3());
  const localCenter = useRef(new THREE.Vector3());
  const referenceCenter = useRef(new THREE.Vector3());
  const localOffsetMidpoint = useRef(new THREE.Vector3());
  const worldStart = useRef(new THREE.Vector3());
  const worldEnd = useRef(new THREE.Vector3());
  const worldOffsetDirection = useRef(new THREE.Vector3());
  const centerMarkerScale = useRef(new THREE.Vector3());
  const identityRotation = useRef(new THREE.Quaternion());
  const offsetRotation = useRef(new THREE.Quaternion());
  const offsetAxis = useRef(new THREE.Vector3(0, 1, 0));
  const zeroScale = useRef(new THREE.Vector3(0, 0, 0));
  const unitScale = useRef(new THREE.Vector3(1, 1, 1));

  const crossGeometry = useMemo(
    () => createCrossGeometry(globalSize * 0.72),
    [globalSize],
  );
  const globalGeometry = useMemo(
    // Use a diamond-like glyph instead of a sphere for clearer COM semantics.
    () => new THREE.OctahedronGeometry(globalSize * 1.2, 0),
    [globalSize],
  );
  const linkComGeometry = useMemo(
    // A small octahedron reads as a marker glyph more clearly than a dot.
    () => new THREE.OctahedronGeometry(linkSize * 1.2, 0),
    [linkSize],
  );
  const centerMarkerGeometry = useMemo(
    () =>
      new THREE.CylinderGeometry(
        1,
        1,
        1,
        INERTIA_CENTER_OFFSET_LINE_RADIAL_SEGMENTS,
      ),
    [],
  );
  const inertiaGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: COM_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  const globalMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COM_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const linkMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COM_COLOR,
        wireframe: true,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const createInertiaMaterial = useMemo(
    () => (color: number, opacity: number, wireframe: boolean) => {
      void gpuMode;
      return new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        wireframe,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: wireframe ? -3 : -1,
        polygonOffsetUnits: wireframe ? -3 : -1,
      });
    },
    [gpuMode],
  );
  const inertiaFillMaterialsByGroup = useMemo(
    () => ({
      healthy: createInertiaMaterial(
        INERTIA_SHAPE_FILL_COLOR_HEALTHY,
        inertiaOpacity,
        false,
      ),
      warning: createInertiaMaterial(
        INERTIA_SHAPE_FILL_COLOR_WARNING,
        inertiaOpacity,
        false,
      ),
      problematic: createInertiaMaterial(
        INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
        inertiaOpacity,
        false,
      ),
      unverified: createInertiaMaterial(
        INERTIA_SHAPE_FILL_COLOR_UNVERIFIED,
        inertiaOpacity,
        false,
      ),
    }),
    [createInertiaMaterial, inertiaOpacity],
  );
  const inertiaEdgeMaterialsByGroup = useMemo(
    () => ({
      healthy: createInertiaMaterial(
        INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
        INERTIA_VOLUME_EDGE_OPACITY,
        true,
      ),
      warning: createInertiaMaterial(
        INERTIA_VOLUME_EDGE_COLOR_WARNING,
        INERTIA_VOLUME_EDGE_OPACITY,
        true,
      ),
      problematic: createInertiaMaterial(
        INERTIA_VOLUME_EDGE_COLOR_PROBLEMATIC,
        INERTIA_VOLUME_EDGE_OPACITY,
        true,
      ),
      unverified: createInertiaMaterial(
        INERTIA_VOLUME_EDGE_COLOR_UNVERIFIED,
        INERTIA_VOLUME_EDGE_OPACITY,
        true,
      ),
    }),
    [createInertiaMaterial],
  );
  const centerMarkerMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: INERTIA_CENTER_MARKER_COLOR,
        transparent: true,
        opacity: INERTIA_CENTER_MARKER_OPACITY,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const referenceMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: INERTIA_REFERENCE_BOX_COLOR,
        transparent: true,
        opacity: INERTIA_REFERENCE_BOX_OPACITY,
        wireframe: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  );
  const deemphasizedOutlineMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: INERTIA_DEEMPHASIZED_OUTLINE_COLOR,
        transparent: true,
        opacity: INERTIA_DEEMPHASIZED_OUTLINE_OPACITY,
        wireframe: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    [],
  );

  useEffect(() => () => crossGeometry.dispose(), [crossGeometry]);
  useEffect(() => () => globalGeometry.dispose(), [globalGeometry]);
  useEffect(() => () => linkComGeometry.dispose(), [linkComGeometry]);
  useEffect(() => () => centerMarkerGeometry.dispose(), [centerMarkerGeometry]);
  useEffect(() => () => inertiaGeometry.dispose(), [inertiaGeometry]);
  useEffect(() => () => lineMaterial.dispose(), [lineMaterial]);
  useEffect(() => () => globalMaterial.dispose(), [globalMaterial]);
  useEffect(() => () => linkMaterial.dispose(), [linkMaterial]);
  useEffect(
    () => () => {
      Object.values(inertiaFillMaterialsByGroup).forEach((material) =>
        material.dispose(),
      );
    },
    [inertiaFillMaterialsByGroup],
  );
  useEffect(
    () => () => {
      Object.values(inertiaEdgeMaterialsByGroup).forEach((material) =>
        material.dispose(),
      );
    },
    [inertiaEdgeMaterialsByGroup],
  );
  useEffect(() => () => centerMarkerMaterial.dispose(), [centerMarkerMaterial]);
  useEffect(() => () => referenceMaterial.dispose(), [referenceMaterial]);
  useEffect(
    () => () => deemphasizedOutlineMaterial.dispose(),
    [deemphasizedOutlineMaterial],
  );

  useEffect(() => {
    if (linkComRef.current) {
      linkComRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    Object.values(inertiaFillRefs.current).forEach((mesh) => {
      mesh?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    });
    Object.values(inertiaEdgeRefs.current).forEach((mesh) => {
      mesh?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    });
    if (centerMarkerRef.current) {
      centerMarkerRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    if (referenceRef.current) {
      referenceRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    if (deemphasizedOutlineRef.current) {
      deemphasizedOutlineRef.current.instanceMatrix.setUsage(
        THREE.DynamicDrawUsage,
      );
    }
  }, [
    activeVisibleLinkIndices.length,
    deemphasizedVisibleLinkIndices.length,
    shapeGroups,
    volumeGroups,
    referenceIndices.length,
    showInertia,
    showLinkCom,
    showReferenceGeometry,
  ]);

  useEffect(() => {
    if (!onReliabilityChange) return;
    onReliabilityChange(showInertia ? reliabilityEntries : []);
  }, [onReliabilityChange, reliabilityEntries, showInertia]);

  const writeInertiaBoxInstanceMatrix = (
    mesh: THREE.InstancedMesh,
    linkIndex: number,
    instanceIndex: number,
    box: InertiaBox,
  ) => {
    const transform = transformCache.current[linkIndex];
    const center = box.center ?? [0, 0, 0];
    inertiaBoxCenter.current.set(center[0], center[1], center[2]);
    inertiaBoxSize.current.set(box.size[0], box.size[1], box.size[2]);
    inertiaLocalBoxMatrix.current.compose(
      inertiaBoxCenter.current,
      box.rotation,
      inertiaBoxSize.current,
    );
    tempMatrix.current.multiplyMatrices(
      transform.inertialWorldMatrix,
      inertiaLocalBoxMatrix.current,
    );
    mesh.setMatrixAt(instanceIndex, tempMatrix.current);
  };

  const writeInertiaBoxGroupMatrices = (
    mesh: THREE.InstancedMesh | null | undefined,
    linkIndices: readonly number[],
    selectBox: (box: ReliableInertiaBox) => InertiaBox | null | undefined,
  ) => {
    if (!mesh) return;
    linkIndices.forEach((linkIndex, instanceIndex) => {
      const reliableBox = inertiaByIndex.get(linkIndex);
      if (!reliableBox) return;
      const selectedBox = selectBox(reliableBox);
      if (!selectedBox) return;
      writeInertiaBoxInstanceMatrix(
        mesh,
        linkIndex,
        instanceIndex,
        selectedBox,
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  useFrame(() => {
    if (!robot || inertials.length === 0) {
      if (globalRef.current) {
        globalRef.current.visible = false;
      }
      return;
    }

    if (!showGlobal && !showLinkCom && !showInertia && !showReferenceGeometry) {
      return;
    }

    robot.updateMatrixWorld(true);

    if (transformCache.current.length !== inertials.length) {
      transformCache.current = inertials.map(() => ({
        position: new THREE.Vector3(),
        inertialWorldMatrix: new THREE.Matrix4(),
      }));
    }

    let totalMass = 0;
    const sum = new THREE.Vector3();

    inertials.forEach((item, index) => {
      const linkObj = resolveLinkObject(item.linkName);
      if (!linkObj) return;

      linkObj.updateMatrixWorld(true);

      composeUrdfPoseMatrix(
        {
          xyz: item.origin,
          rpy: item.rpy,
        },
        inertialMatrix.current,
      );
      composeWorldMatrixFromLinkAndLocal(
        linkObj.matrixWorld,
        inertialMatrix.current,
        inertialWorldMatrix.current,
      );
      transformCache.current[index].inertialWorldMatrix.copy(
        inertialWorldMatrix.current,
      );
      transformCache.current[index].position.setFromMatrixPosition(
        inertialWorldMatrix.current,
      );

      sum.addScaledVector(transformCache.current[index].position, item.mass);
      totalMass += item.mass;
    });

    if (showLinkCom && linkComRef.current) {
      visibleLinkIndices.forEach((linkIndex, instanceIndex) => {
        tempMatrix.current.compose(
          transformCache.current[linkIndex].position,
          identityRotation.current,
          unitScale.current,
        );
        linkComRef.current?.setMatrixAt(instanceIndex, tempMatrix.current);
      });
      linkComRef.current.instanceMatrix.needsUpdate = true;
    }

    if (showInertia) {
      const centerMesh = centerMarkerRef.current;
      shapeGroups.forEach((group) => {
        writeInertiaBoxGroupMatrices(
          inertiaFillRefs.current[group.key],
          group.indices,
          (box) => box.box,
        );
      });

      volumeGroups.forEach((group) => {
        writeInertiaBoxGroupMatrices(
          inertiaEdgeRefs.current[group.key],
          group.indices,
          (box) => box.box,
        );
      });

      if (centerMesh) {
        activeVisibleLinkIndices.forEach((linkIndex, instanceIndex) => {
          const box = inertiaByIndex.get(linkIndex);
          if (!box) {
            return;
          }
          const transform = transformCache.current[linkIndex];
          const center = box.box.center ?? [0, 0, 0];
          const markerScale = resolveInertiaCenterMarkerScale({
            centerMismatch: box.mismatchBreakdown?.center,
            centerOfMassOutsideReference: box.centerOfMassOutsideReference,
          });
          const reference = box.referenceBox?.center ?? null;
          if (!reference || markerScale <= 0) {
            tempMatrix.current.compose(
              transform.position,
              identityRotation.current,
              zeroScale.current,
            );
            centerMesh.setMatrixAt(instanceIndex, tempMatrix.current);
            return;
          }

          referenceCenter.current.set(reference[0], reference[1], reference[2]);
          localCenter.current.set(center[0], center[1], center[2]);
          worldStart.current
            .copy(referenceCenter.current)
            .applyMatrix4(transform.inertialWorldMatrix);
          worldEnd.current
            .copy(localCenter.current)
            .applyMatrix4(transform.inertialWorldMatrix);
          worldOffsetDirection.current.subVectors(
            worldEnd.current,
            worldStart.current,
          );
          const offsetLength = worldOffsetDirection.current.length();

          if (offsetLength <= INERTIA_CENTER_OFFSET_MIN_LENGTH_METERS) {
            tempMatrix.current.compose(
              worldStart.current,
              identityRotation.current,
              zeroScale.current,
            );
            centerMesh.setMatrixAt(instanceIndex, tempMatrix.current);
            return;
          }

          worldOffsetDirection.current.normalize();
          offsetRotation.current.setFromUnitVectors(
            offsetAxis.current,
            worldOffsetDirection.current,
          );
          localOffsetMidpoint.current
            .copy(worldStart.current)
            .lerp(worldEnd.current, 0.5);
          centerMarkerScale.current.set(
            INERTIA_CENTER_MARKER_BASE_SIZE_METERS * markerScale,
            offsetLength,
            INERTIA_CENTER_MARKER_BASE_SIZE_METERS * markerScale,
          );
          tempMatrix.current.compose(
            localOffsetMidpoint.current,
            offsetRotation.current,
            centerMarkerScale.current,
          );
          centerMesh.setMatrixAt(instanceIndex, tempMatrix.current);
        });
        centerMesh.instanceMatrix.needsUpdate = true;
      }
    }

    if (showInertia) {
      writeInertiaBoxGroupMatrices(
        deemphasizedOutlineRef.current,
        deemphasizedVisibleLinkIndices,
        (box) => box.box,
      );
    }

    if (showReferenceGeometry) {
      writeInertiaBoxGroupMatrices(
        referenceRef.current,
        referenceIndices,
        (box) => box.referenceBox,
      );
    }

    if (showGlobal && globalRef.current) {
      if (totalMass > 0) {
        globalRef.current.visible = true;
        globalRef.current.position.copy(sum.multiplyScalar(1 / totalMass));
      } else {
        globalRef.current.visible = false;
      }
    }
  });

  const linkComCount = showLinkCom ? visibleLinkIndices.length : 0;
  const inertiaCount = showInertia ? activeVisibleLinkIndices.length : 0;
  const deemphasizedOutlineCount = showInertia
    ? deemphasizedVisibleLinkIndices.length
    : 0;
  const referenceCount = showReferenceGeometry ? referenceIndices.length : 0;

  return (
    <>
      {showGlobal && (
        <group ref={globalRef} visible={false} renderOrder={3000}>
          <mesh
            geometry={globalGeometry}
            material={globalMaterial}
            renderOrder={3001}
          />
          <lineSegments
            geometry={crossGeometry}
            material={lineMaterial}
            renderOrder={3002}
          />
        </group>
      )}
      {showLinkCom && linkComCount > 0 && (
        <instancedMesh
          ref={linkComRef}
          args={[linkComGeometry, linkMaterial, linkComCount]}
          renderOrder={3000}
        />
      )}
      {showInertia &&
        shapeGroups.map((group) =>
          group.indices.length > 0 ? (
            <instancedMesh
              key={`inertia-fill-${group.key}`}
              ref={(mesh) => {
                inertiaFillRefs.current[group.key] = mesh;
              }}
              args={[
                inertiaGeometry,
                inertiaFillMaterialsByGroup[group.key],
                group.indices.length,
              ]}
              renderOrder={2996}
            />
          ) : null,
        )}
      {showInertia &&
        volumeGroups.map((group) =>
          group.indices.length > 0 ? (
            <instancedMesh
              key={`inertia-edge-${group.key}`}
              ref={(mesh) => {
                inertiaEdgeRefs.current[group.key] = mesh;
              }}
              args={[
                inertiaGeometry,
                inertiaEdgeMaterialsByGroup[group.key],
                group.indices.length,
              ]}
              renderOrder={2998}
            />
          ) : null,
        )}
      {showInertia && deemphasizedOutlineCount > 0 && (
        <instancedMesh
          ref={deemphasizedOutlineRef}
          args={[
            inertiaGeometry,
            deemphasizedOutlineMaterial,
            deemphasizedOutlineCount,
          ]}
          renderOrder={2998}
        />
      )}
      {showInertia && inertiaCount > 0 && (
        <instancedMesh
          ref={centerMarkerRef}
          args={[centerMarkerGeometry, centerMarkerMaterial, inertiaCount]}
          renderOrder={2999}
        />
      )}
      {showReferenceGeometry && referenceCount > 0 && (
        <instancedMesh
          ref={referenceRef}
          args={[inertiaGeometry, referenceMaterial, referenceCount]}
          renderOrder={2997}
        />
      )}
    </>
  );
};
