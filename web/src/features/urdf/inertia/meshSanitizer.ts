import * as THREE from "three";
import {
  MESH_SANITIZER_MAX_COM_SHIFT_CHARACTERISTIC_LENGTH_RATIO,
  MESH_SANITIZER_MAX_INERTIA_TRACE_CHANGE_RATIO,
  MESH_SANITIZER_MAX_MASS_LOSS_RATIO,
  MESH_SANITIZER_MAX_PHYSICS_IMPACT_RATIO,
  MESH_SANITIZER_MAX_TOTAL_DELETION_RATIO,
  MESH_SANITIZER_MIN_COMPONENT_VOLUME_RATIO,
  MESH_SANITIZER_SIGNIFICANT_MASS_LOSS_RATIO,
  MESH_SANITIZER_VERTEX_KEY_DECIMALS,
} from "./meshSanitizerParams";

/**
 * Performs conservative disconnected-island cleanup for URDF link meshes.
 *
 * Design goals:
 * - Conservatism: only delete candidate shells when the resulting physics delta is negligible.
 * - Traceability: every accepted or blocked cleanup carries structured metrics and reasons.
 * - Scale awareness: CoM tolerances scale with the link's characteristic length instead of using
 *   a single absolute threshold for every robot.
 */
export type MeshSanitizationStatus = "unchanged" | "sanitized" | "excessive-deletion";
export type MeshDeletionSafetyStatus = "safe" | "manual-review" | "not-applicable";
export type MeshMassSignificance = "not-applicable" | "negligible" | "significant";

export type MeshDeletionSafetyReport = {
  status: MeshDeletionSafetyStatus;
  isSafeToDelete: boolean;
  metrics: {
    comShiftMeters: number;
    normalizedComShiftRatio: number;
    massLossRatio: number;
    inertiaTraceChangeRatio: number;
    physicsImpactRatio: number;
    maxAllowedComShiftMeters: number;
    characteristicLengthMeters: number;
  };
  reasons: string[];
};

export type MeshSanitizationDiagnostics = {
  status: MeshSanitizationStatus;
  massSignificance: MeshMassSignificance;
  originalVertexCount: number;
  finalVertexCount: number;
  originalTriangleCount: number;
  finalTriangleCount: number;
  totalComponents: number;
  removedComponents: number;
  volumeRetainedRatio: number;
  deletionSafetyReport: MeshDeletionSafetyReport;
};

type MeshTriangleRecord = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  vertexKeys: [string, string, string];
  signedVolume: number;
};

type MeshSanitizerOptions = {
  minComponentVolumeRatio?: number;
  maxTotalDeletionRatio?: number;
  maxComShiftCharacteristicLengthRatio?: number;
  maxMassLossRatio?: number;
  maxInertiaTraceChangeRatio?: number;
};

type TriangleMassProperties = {
  mass: number;
  centerOfMass: THREE.Vector3;
  inertiaAtCenter: THREE.Matrix3;
};

const roundCoordinate = (value: number): number =>
  Number(value.toFixed(MESH_SANITIZER_VERTEX_KEY_DECIMALS));

const toVertexKey = (vector: THREE.Vector3): string =>
  `${roundCoordinate(vector.x)}|${roundCoordinate(vector.y)}|${roundCoordinate(vector.z)}`;

const toEdgeKey = (lhs: string, rhs: string): string => (lhs < rhs ? `${lhs}::${rhs}` : `${rhs}::${lhs}`);

const computeSignedTriangleVolume = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number =>
  a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;

const collectMeshTriangles = (object: THREE.Object3D): MeshTriangleRecord[] => {
  object.updateMatrixWorld(true);
  const triangles: MeshTriangleRecord[] = [];
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!mesh.isMesh || !geometry || !position || position.itemSize < 3) {
      return;
    }

    const matrix = mesh.matrixWorld.clone();
    const pushTriangle = (aIndex: number, bIndex: number, cIndex: number) => {
      const a = vertexA.fromBufferAttribute(position, aIndex).clone().applyMatrix4(matrix);
      const b = vertexB.fromBufferAttribute(position, bIndex).clone().applyMatrix4(matrix);
      const c = vertexC.fromBufferAttribute(position, cIndex).clone().applyMatrix4(matrix);
      triangles.push({
        a,
        b,
        c,
        vertexKeys: [toVertexKey(a), toVertexKey(b), toVertexKey(c)],
        signedVolume: computeSignedTriangleVolume(a, b, c),
      });
    };

    const index = geometry.getIndex();
    if (index) {
      const indexArray = index.array;
      for (let i = 0; i + 2 < indexArray.length; i += 3) {
        pushTriangle(indexArray[i] as number, indexArray[i + 1] as number, indexArray[i + 2] as number);
      }
      return;
    }

    for (let i = 0; i + 2 < position.count; i += 3) {
      pushTriangle(i, i + 1, i + 2);
    }
  });

  return triangles;
};

const buildConnectedComponents = (triangles: MeshTriangleRecord[]): number[][] => {
  const edgeToTriangles = new Map<string, number[]>();
  triangles.forEach((triangle, triangleIndex) => {
    const [aKey, bKey, cKey] = triangle.vertexKeys;
    const edgeKeys = [toEdgeKey(aKey, bKey), toEdgeKey(bKey, cKey), toEdgeKey(cKey, aKey)];
    edgeKeys.forEach((edgeKey) => {
      const indices = edgeToTriangles.get(edgeKey) ?? [];
      indices.push(triangleIndex);
      edgeToTriangles.set(edgeKey, indices);
    });
  });

  const adjacency = Array.from({ length: triangles.length }, () => new Set<number>());
  edgeToTriangles.forEach((triangleIndices) => {
    if (triangleIndices.length < 2) {
      return;
    }
    for (let i = 0; i < triangleIndices.length; i += 1) {
      for (let j = i + 1; j < triangleIndices.length; j += 1) {
        adjacency[triangleIndices[i]].add(triangleIndices[j]);
        adjacency[triangleIndices[j]].add(triangleIndices[i]);
      }
    }
  });

  const visited = new Set<number>();
  const components: number[][] = [];
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    if (visited.has(triangleIndex)) {
      continue;
    }
    const queue = [triangleIndex];
    visited.add(triangleIndex);
    const component: number[] = [];
    while (queue.length > 0) {
      const current = queue.shift() as number;
      component.push(current);
      adjacency[current].forEach((neighbor) => {
        if (visited.has(neighbor)) {
          return;
        }
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }
    components.push(component);
  }
  return components;
};

const countUniqueVertices = (triangles: MeshTriangleRecord[]): number => {
  const uniqueVertexKeys = new Set<string>();
  triangles.forEach((triangle) => {
    triangle.vertexKeys.forEach((vertexKey) => uniqueVertexKeys.add(vertexKey));
  });
  return uniqueVertexKeys.size;
};

const createNotApplicableDeletionSafetyReport = (): MeshDeletionSafetyReport => ({
  status: "not-applicable",
  isSafeToDelete: true,
  metrics: {
    comShiftMeters: 0,
    normalizedComShiftRatio: 0,
    massLossRatio: 0,
    inertiaTraceChangeRatio: 0,
    physicsImpactRatio: 0,
    maxAllowedComShiftMeters: 0,
    characteristicLengthMeters: 0,
  },
  reasons: [],
});

const createManualReviewDeletionSafetyReport = (reasons: string[]): MeshDeletionSafetyReport => ({
  status: "manual-review",
  isSafeToDelete: false,
  metrics: {
    comShiftMeters: 0,
    normalizedComShiftRatio: 0,
    massLossRatio: 0,
    inertiaTraceChangeRatio: 0,
    physicsImpactRatio: 0,
    maxAllowedComShiftMeters: 0,
    characteristicLengthMeters: 0,
  },
  reasons,
});

const createSymmetricMatrix3 = (
  n11: number,
  n12: number,
  n13: number,
  n22: number,
  n23: number,
  n33: number
): THREE.Matrix3 => new THREE.Matrix3().set(n11, n12, n13, n12, n22, n23, n13, n23, n33);

const buildParallelAxisMatrix = (mass: number, offset: THREE.Vector3): THREE.Matrix3 => {
  const { x, y, z } = offset;
  const squaredDistance = x * x + y * y + z * z;
  return createSymmetricMatrix3(
    mass * (squaredDistance - x * x),
    -mass * x * y,
    -mass * x * z,
    mass * (squaredDistance - y * y),
    -mass * y * z,
    mass * (squaredDistance - z * z)
  );
};

const addMatrix3 = (lhs: THREE.Matrix3, rhs: THREE.Matrix3): THREE.Matrix3 => {
  const lhsArray = lhs.toArray();
  const rhsArray = rhs.toArray();
  return new THREE.Matrix3().fromArray(lhsArray.map((value, index) => value + rhsArray[index]));
};

const shiftInertiaFromPoint = (
  inertiaAtOrigin: THREE.Matrix3,
  mass: number,
  offset: THREE.Vector3
): THREE.Matrix3 => addMatrix3(inertiaAtOrigin, buildParallelAxisMatrix(mass, offset));

const computeTriangleMassProperties = (triangles: MeshTriangleRecord[]): TriangleMassProperties | null => {
  let totalSignedVolume = 0;
  const firstMoment = new THREE.Vector3();
  let integralXX = 0;
  let integralYY = 0;
  let integralZZ = 0;
  let integralXY = 0;
  let integralXZ = 0;
  let integralYZ = 0;

  triangles.forEach(({ a, b, c, signedVolume }) => {
    if (!Number.isFinite(signedVolume) || Math.abs(signedVolume) <= Number.EPSILON) {
      return;
    }
    totalSignedVolume += signedVolume;
    firstMoment.add(a.clone().add(b).add(c).multiplyScalar(signedVolume / 4));

    const f1x = a.x * a.x + b.x * b.x + c.x * c.x + a.x * b.x + b.x * c.x + c.x * a.x;
    const f1y = a.y * a.y + b.y * b.y + c.y * c.y + a.y * b.y + b.y * c.y + c.y * a.y;
    const f1z = a.z * a.z + b.z * b.z + c.z * c.z + a.z * b.z + b.z * c.z + c.z * a.z;
    const f2xy =
      2 * a.x * a.y +
      2 * b.x * b.y +
      2 * c.x * c.y +
      a.x * b.y +
      a.y * b.x +
      a.x * c.y +
      a.y * c.x +
      b.x * c.y +
      b.y * c.x;
    const f2xz =
      2 * a.x * a.z +
      2 * b.x * b.z +
      2 * c.x * c.z +
      a.x * b.z +
      a.z * b.x +
      a.x * c.z +
      a.z * c.x +
      b.x * c.z +
      b.z * c.x;
    const f2yz =
      2 * a.y * a.z +
      2 * b.y * b.z +
      2 * c.y * c.z +
      a.y * b.z +
      a.z * b.y +
      a.y * c.z +
      a.z * c.y +
      b.y * c.z +
      b.z * c.y;

    integralXX += signedVolume * f1x / 10;
    integralYY += signedVolume * f1y / 10;
    integralZZ += signedVolume * f1z / 10;
    integralXY += signedVolume * f2xy / 20;
    integralXZ += signedVolume * f2xz / 20;
    integralYZ += signedVolume * f2yz / 20;
  });

  if (!Number.isFinite(totalSignedVolume) || Math.abs(totalSignedVolume) <= Number.EPSILON) {
    return null;
  }

  const orientationSign = Math.sign(totalSignedVolume) || 1;
  const mass = Math.abs(totalSignedVolume);
  const centerOfMass = firstMoment.multiplyScalar(1 / totalSignedVolume);
  const inertiaAtOrigin = createSymmetricMatrix3(
    orientationSign * (integralYY + integralZZ),
    -orientationSign * integralXY,
    -orientationSign * integralXZ,
    orientationSign * (integralXX + integralZZ),
    -orientationSign * integralYZ,
    orientationSign * (integralXX + integralYY)
  );
  return {
    mass,
    centerOfMass,
    inertiaAtCenter: shiftInertiaFromPoint(inertiaAtOrigin, mass, centerOfMass),
  };
};

const computeMatrixTrace = (matrix: THREE.Matrix3): number => {
  const elements = matrix.elements;
  return elements[0] + elements[4] + elements[8];
};

const computeCharacteristicLength = (triangles: MeshTriangleRecord[]): number => {
  if (triangles.length === 0) {
    return 0;
  }
  const bounds = new THREE.Box3();
  triangles.forEach(({ a, b, c }) => {
    bounds.expandByPoint(a);
    bounds.expandByPoint(b);
    bounds.expandByPoint(c);
  });
  return bounds.getSize(new THREE.Vector3()).length();
};

const buildDeletionSafetyReport = ({
  originalTriangles,
  retainedTriangles,
  maxComShiftCharacteristicLengthRatio,
  maxMassLossRatio,
  maxInertiaTraceChangeRatio,
}: {
  originalTriangles: MeshTriangleRecord[];
  retainedTriangles: MeshTriangleRecord[];
  maxComShiftCharacteristicLengthRatio: number;
  maxMassLossRatio: number;
  maxInertiaTraceChangeRatio: number;
}): MeshDeletionSafetyReport => {
  const originalProperties = computeTriangleMassProperties(originalTriangles);
  const retainedProperties = computeTriangleMassProperties(retainedTriangles);
  if (!originalProperties || !retainedProperties || originalProperties.mass <= Number.EPSILON) {
    return createManualReviewDeletionSafetyReport(["cleanup delta could not be validated"]);
  }
  const characteristicLengthMeters = computeCharacteristicLength(originalTriangles);
  const maxAllowedComShiftMeters =
    characteristicLengthMeters * maxComShiftCharacteristicLengthRatio;
  if (retainedTriangles.length === 0 || characteristicLengthMeters <= Number.EPSILON) {
    return createManualReviewDeletionSafetyReport(["cleanup would remove all meaningful geometry"]);
  }

  const comShiftMeters = originalProperties.centerOfMass.distanceTo(retainedProperties.centerOfMass);
  const normalizedComShiftRatio =
    maxAllowedComShiftMeters > Number.EPSILON ? comShiftMeters / maxAllowedComShiftMeters : Number.POSITIVE_INFINITY;
  const massLossRatio = Math.max(0, originalProperties.mass - retainedProperties.mass) / originalProperties.mass;
  const originalTrace = computeMatrixTrace(originalProperties.inertiaAtCenter);
  const retainedTrace = computeMatrixTrace(retainedProperties.inertiaAtCenter);
  const inertiaTraceChangeRatio =
    Math.abs(originalTrace) > Number.EPSILON
      ? Math.abs(originalTrace - retainedTrace) / Math.abs(originalTrace)
      : 0;
  const physicsImpactRatio = Math.max(
    massLossRatio,
    inertiaTraceChangeRatio,
    normalizedComShiftRatio * MESH_SANITIZER_MAX_PHYSICS_IMPACT_RATIO
  );

  const reasons: string[] = [];
  if (comShiftMeters > maxAllowedComShiftMeters) {
    reasons.push("center of mass shift exceeded cleanup safety threshold");
  }
  if (massLossRatio > maxMassLossRatio) {
    reasons.push("mass loss exceeded cleanup safety threshold");
  }
  if (inertiaTraceChangeRatio > maxInertiaTraceChangeRatio) {
    reasons.push("inertia trace change exceeded cleanup safety threshold");
  }

  return {
    status: reasons.length > 0 ? "manual-review" : "safe",
    isSafeToDelete: reasons.length === 0,
    metrics: {
      comShiftMeters,
      normalizedComShiftRatio,
      massLossRatio,
      inertiaTraceChangeRatio,
      physicsImpactRatio,
      maxAllowedComShiftMeters,
      characteristicLengthMeters,
    },
    reasons,
  };
};

const buildSanitizedObject = (triangles: MeshTriangleRecord[]): THREE.Object3D => {
  const positions = new Float32Array(triangles.length * 9);
  triangles.forEach((triangle, triangleIndex) => {
    const baseIndex = triangleIndex * 9;
    positions[baseIndex] = triangle.a.x;
    positions[baseIndex + 1] = triangle.a.y;
    positions[baseIndex + 2] = triangle.a.z;
    positions[baseIndex + 3] = triangle.b.x;
    positions[baseIndex + 4] = triangle.b.y;
    positions[baseIndex + 5] = triangle.b.z;
    positions[baseIndex + 6] = triangle.c.x;
    positions[baseIndex + 7] = triangle.c.y;
    positions[baseIndex + 8] = triangle.c.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
};

export const sanitizeMeshObject = (
  object: THREE.Object3D,
  {
    minComponentVolumeRatio = MESH_SANITIZER_MIN_COMPONENT_VOLUME_RATIO,
    maxTotalDeletionRatio = MESH_SANITIZER_MAX_TOTAL_DELETION_RATIO,
    maxComShiftCharacteristicLengthRatio = MESH_SANITIZER_MAX_COM_SHIFT_CHARACTERISTIC_LENGTH_RATIO,
    maxMassLossRatio = MESH_SANITIZER_MAX_MASS_LOSS_RATIO,
    maxInertiaTraceChangeRatio = MESH_SANITIZER_MAX_INERTIA_TRACE_CHANGE_RATIO,
  }: MeshSanitizerOptions = {}
): { object: THREE.Object3D; diagnostics: MeshSanitizationDiagnostics } => {
  const triangles = collectMeshTriangles(object);
  const originalVertexCount = countUniqueVertices(triangles);
  const originalTriangleCount = triangles.length;
  if (triangles.length === 0) {
    return {
      object,
      diagnostics: {
        status: "unchanged",
        massSignificance: "not-applicable",
        originalVertexCount,
        finalVertexCount: originalVertexCount,
        originalTriangleCount,
        finalTriangleCount: originalTriangleCount,
        totalComponents: 0,
        removedComponents: 0,
        volumeRetainedRatio: 1,
        deletionSafetyReport: createNotApplicableDeletionSafetyReport(),
      },
    };
  }

  const components = buildConnectedComponents(triangles);
  if (components.length <= 1) {
    return {
      object,
      diagnostics: {
        status: "unchanged",
        massSignificance: "not-applicable",
        originalVertexCount,
        finalVertexCount: originalVertexCount,
        originalTriangleCount,
        finalTriangleCount: originalTriangleCount,
        totalComponents: components.length,
        removedComponents: 0,
        volumeRetainedRatio: 1,
        deletionSafetyReport: createNotApplicableDeletionSafetyReport(),
      },
    };
  }

  const componentVolumes = components.map((component) =>
    Math.abs(component.reduce((sum, triangleIndex) => sum + triangles[triangleIndex].signedVolume, 0))
  );
  const maxComponentVolume = Math.max(...componentVolumes);
  const totalVolume = componentVolumes.reduce((sum, volume) => sum + volume, 0);
  if (maxComponentVolume <= 0 || totalVolume <= 0) {
    return {
      object,
      diagnostics: {
        status: "unchanged",
        massSignificance: "not-applicable",
        originalVertexCount,
        finalVertexCount: originalVertexCount,
        originalTriangleCount,
        finalTriangleCount: originalTriangleCount,
        totalComponents: components.length,
        removedComponents: 0,
        volumeRetainedRatio: 1,
        deletionSafetyReport: createNotApplicableDeletionSafetyReport(),
      },
    };
  }

  const retainedTriangleIndices = new Set<number>();
  let removedComponents = 0;
  let retainedVolume = 0;
  components.forEach((component, componentIndex) => {
    const componentVolume = componentVolumes[componentIndex];
    const keepComponent = componentVolume >= maxComponentVolume * minComponentVolumeRatio;
    if (!keepComponent) {
      removedComponents += 1;
      return;
    }
    retainedVolume += componentVolume;
    component.forEach((triangleIndex) => retainedTriangleIndices.add(triangleIndex));
  });

  if (removedComponents === 0) {
    return {
      object,
      diagnostics: {
        status: "unchanged",
        massSignificance: "not-applicable",
        originalVertexCount,
        finalVertexCount: originalVertexCount,
        originalTriangleCount,
        finalTriangleCount: originalTriangleCount,
        totalComponents: components.length,
        removedComponents: 0,
        volumeRetainedRatio: 1,
        deletionSafetyReport: createNotApplicableDeletionSafetyReport(),
      },
    };
  }

  const retainedTriangles = triangles.filter((_, triangleIndex) => retainedTriangleIndices.has(triangleIndex));
  const finalVertexCount = countUniqueVertices(retainedTriangles);
  const volumeRetainedRatio = retainedVolume / totalVolume;
  const excessiveDeletion = 1 - volumeRetainedRatio > maxTotalDeletionRatio;
  const deletionSafetyReport = buildDeletionSafetyReport({
    originalTriangles: triangles,
    retainedTriangles,
    maxComShiftCharacteristicLengthRatio,
    maxMassLossRatio,
    maxInertiaTraceChangeRatio,
  });
  const massSignificance: MeshMassSignificance =
    deletionSafetyReport.metrics.massLossRatio > MESH_SANITIZER_SIGNIFICANT_MASS_LOSS_RATIO
      ? "significant"
      : "negligible";
  if (excessiveDeletion || deletionSafetyReport.status === "manual-review") {
    return {
      object,
      diagnostics: {
        status: "excessive-deletion",
        massSignificance,
        originalVertexCount,
        finalVertexCount,
        originalTriangleCount,
        finalTriangleCount: retainedTriangles.length,
        totalComponents: components.length,
        removedComponents,
        volumeRetainedRatio,
        deletionSafetyReport,
      },
    };
  }

  return {
    object: buildSanitizedObject(retainedTriangles),
    diagnostics: {
      status: "sanitized",
      massSignificance,
      originalVertexCount,
      finalVertexCount,
      originalTriangleCount,
      finalTriangleCount: retainedTriangles.length,
      totalComponents: components.length,
      removedComponents,
      volumeRetainedRatio,
      deletionSafetyReport,
    },
  };
};
