import {
  computeCylinderDiagnostics,
  computePCA,
  computeRotationToAxis,
  computeSphereDiagnostics,
  fitCylinderConstrainedAxis,
  fitCylinderPercentilePCA,
  type MeshBounds,
  type OriginData,
} from "@/features/urdf";

export type CollisionAutoFitType = "box" | "sphere" | "cylinder" | "capsule";

export type CollisionAutoFitResult = {
  geometryType: "box" | "sphere" | "cylinder";
  geometryParams: Record<string, string>;
  origin: OriginData;
  method: string;
  formula: string;
  warning?: string;
};

type TransformResult = {
  vertices: Float32Array;
  min: [number, number, number];
  max: [number, number, number];
};

const transformVerticesToLinkFrame = (
  vertices: Float32Array,
  origin: OriginData
): TransformResult => {
  const [rx, ry, rz] = origin.rpy;
  const [tx, ty, tz] = origin.xyz;

  const cosRx = Math.cos(rx);
  const sinRx = Math.sin(rx);
  const cosRy = Math.cos(ry);
  const sinRy = Math.sin(ry);
  const cosRz = Math.cos(rz);
  const sinRz = Math.sin(rz);

  const R = [
    [
      cosRz * cosRy,
      cosRz * sinRy * sinRx - sinRz * cosRx,
      cosRz * sinRy * cosRx + sinRz * sinRx,
    ],
    [
      sinRz * cosRy,
      sinRz * sinRy * sinRx + cosRz * cosRx,
      sinRz * sinRy * cosRx - cosRz * sinRx,
    ],
    [-sinRy, cosRy * sinRx, cosRy * cosRx],
  ];

  const vertexCount = vertices.length / 3;
  const transformed = new Float32Array(vertices.length);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];

    const xRot = R[0][0] * x + R[0][1] * y + R[0][2] * z;
    const yRot = R[1][0] * x + R[1][1] * y + R[1][2] * z;
    const zRot = R[2][0] * x + R[2][1] * y + R[2][2] * z;

    const xLink = xRot + tx;
    const yLink = yRot + ty;
    const zLink = zRot + tz;

    transformed[i * 3] = xLink;
    transformed[i * 3 + 1] = yLink;
    transformed[i * 3 + 2] = zLink;

    minX = Math.min(minX, xLink);
    minY = Math.min(minY, yLink);
    minZ = Math.min(minZ, zLink);
    maxX = Math.max(maxX, xLink);
    maxY = Math.max(maxY, yLink);
    maxZ = Math.max(maxZ, zLink);
  }

  return {
    vertices: transformed,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
};

export const autoFitCollisionGeometry = (
  bounds: MeshBounds,
  visualOrigin: OriginData,
  requestedType: CollisionAutoFitType
): CollisionAutoFitResult | null => {
  const transformed = transformVerticesToLinkFrame(bounds.vertices, visualOrigin);
  const transformedVerticesArray = transformed.vertices;
  const [minX, minY, minZ] = transformed.min;
  const [maxX, maxY, maxZ] = transformed.max;

  if (requestedType === "box") {
    const boxSize: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
    const boxCenter: [number, number, number] = [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ];

    return {
      geometryType: "box",
      geometryParams: {
        size: `${boxSize[0]} ${boxSize[1]} ${boxSize[2]}`,
      },
      origin: { xyz: boxCenter, rpy: [0, 0, 0] },
      method: "Axis-Aligned Bounding Box (AABB) in Link Frame",
      formula:
        "1. Transform mesh vertices by visual origin (xyz + rpy)\n2. Compute AABB in link coordinate frame\n3. size = [max_x - min_x, max_y - min_y, max_z - min_z]\n4. center = [(min_x + max_x)/2, (min_y + max_y)/2, (min_z + max_z)/2]",
    };
  }

  const pca = computePCA(transformedVerticesArray);
  if (!pca) {
    return null;
  }

  if (requestedType === "sphere") {
    const diagnostics = computeSphereDiagnostics(transformedVerticesArray, pca);

    let methodName: string;
    let formula: string;
    let warning: string | undefined;

    if (diagnostics.isIsotropic) {
      methodName = "Robust Sphere (Isotropic)";
      formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
        2
      )} < 2, flatness=${diagnostics.flatness.toFixed(
        2
      )} < 2\n3. Shape is isotropic → sphere is appropriate\n4. Use 95th percentile radius (robust to outliers)`;
    } else if (diagnostics.isElongated) {
      methodName = "Robust Sphere (Elongated - Not Ideal)";
      warning = `Shape is elongated (elongation=${diagnostics.elongation.toFixed(
        2
      )}). Consider using cylinder/capsule instead.`;
      formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
        2
      )} > 3 (elongated)\n3. Sphere may not be optimal - consider cylinder\n4. Use 95th percentile radius`;
    } else if (diagnostics.isFlat) {
      methodName = "Robust Sphere (Flat - Not Ideal)";
      warning = `Shape is flat (flatness=${diagnostics.flatness.toFixed(
        2
      )}). Consider using box instead.`;
      formula = `1. Transform vertices by visual origin\n2. flatness=${diagnostics.flatness.toFixed(
        2
      )} > 3 (slab-like)\n3. Sphere may not be optimal - consider box\n4. Use 95th percentile radius`;
    } else {
      methodName = "Robust Sphere (Moderate Anisotropy)";
      formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
        2
      )}, flatness=${diagnostics.flatness.toFixed(
        2
      )}\n3. Moderate anisotropy - sphere acceptable\n4. Use 95th percentile radius (robust)`;
    }

    if (diagnostics.outlierRatio > 1.3) {
      warning = warning
        ? `${warning} High outlier ratio (${diagnostics.outlierRatio.toFixed(
            2
          )}) - may have protrusions.`
        : `High outlier ratio (${diagnostics.outlierRatio.toFixed(
            2
          )}) - using robust radius to ignore protrusions.`;
    }

    return {
      geometryType: "sphere",
      geometryParams: {
        radius: String(diagnostics.radialP95),
      },
      origin: {
        xyz: [pca.centroid[0], pca.centroid[1], pca.centroid[2]],
        rpy: [0, 0, 0],
      },
      method: methodName,
      formula,
      warning,
    };
  }

  const diagnostics = computeCylinderDiagnostics(transformedVerticesArray, pca);

  let methodName: string;
  let formula: string;
  let fitResult:
    | {
        radius: number;
        height: number;
        center: [number, number, number];
        axis: [number, number, number];
      }
    | undefined;

  if (diagnostics.elongation > 5) {
    if (diagnostics.roundness < 1.2 && diagnostics.outlierRatio < 1.2) {
      fitResult = fitCylinderPercentilePCA(transformedVerticesArray, pca, diagnostics);
      methodName = "Percentile-based PCA Cylinder";
      formula = `1. Transform vertices by visual origin\n2. Compute PCA diagnostics\n3. elongation=${diagnostics.elongation.toFixed(
        2
      )}, roundness=${diagnostics.roundness.toFixed(
        2
      )}\n4. Use 95th percentile radius (robust)\n5. height = max(t) - min(t) along PCA axis`;
    } else if (diagnostics.roundness > 1.5) {
      fitResult = fitCylinderConstrainedAxis(
        transformedVerticesArray,
        minX,
        maxX,
        minY,
        maxY,
        minZ,
        maxZ
      );
      methodName = "Constrained Axis Fit (Non-circular)";
      const axisName = fitResult.axis[0] === 1 ? "X" : fitResult.axis[1] === 1 ? "Y" : "Z";
      formula = `1. Transform vertices by visual origin\n2. roundness=${diagnostics.roundness.toFixed(
        2
      )} > 1.5 (non-circular)\n3. Use longest AABB dimension: ${axisName}-axis\n4. radius = 95th percentile distance to axis`;
    } else {
      fitResult = fitCylinderPercentilePCA(transformedVerticesArray, pca, diagnostics);
      methodName = "Percentile PCA (with Outliers)";
      formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
        2
      )} > 5, outlier_ratio=${diagnostics.outlierRatio.toFixed(
        2
      )}\n3. Use 95th percentile radius (robust to outliers)\n4. PCA axis with percentile filtering`;
    }
  } else {
    fitResult = fitCylinderConstrainedAxis(
      transformedVerticesArray,
      minX,
      maxX,
      minY,
      maxY,
      minZ,
      maxZ
    );
    methodName = "Constrained Axis (Low Elongation)";
    const axisName = fitResult.axis[0] === 1 ? "X" : fitResult.axis[1] === 1 ? "Y" : "Z";
    formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
      2
    )} < 5 (not strongly cylindrical)\n3. Use longest AABB dimension: ${axisName}-axis\n4. radius = 95th percentile distance to axis`;
  }

  if (!fitResult) {
    return null;
  }

  const rotation = computeRotationToAxis(fitResult.axis);
  const warning =
    requestedType === "capsule" ? "Capsule approximated as cylinder in URDF" : undefined;

  return {
    geometryType: "cylinder",
    geometryParams: {
      radius: String(fitResult.radius),
      length: String(fitResult.height),
    },
    origin: {
      xyz: fitResult.center,
      rpy: rotation.rpy,
    },
    method: methodName,
    formula,
    warning,
  };
};
