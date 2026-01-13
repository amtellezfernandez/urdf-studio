import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { Eye, EyeOff, Info, Trash2 } from "lucide-react";
import {
  computeCylinderDiagnostics,
  computeMeshBounds,
  computePCA,
  computeRotationToAxis,
  computeSphereDiagnostics,
  findMeshFile,
  updateCollisionInLink,
  type CollisionData,
  type LinkData,
} from "@/features/urdf";
import { toast } from "sonner";

interface CollisionControlProps {
  linkName: string;
  collision: CollisionData;
  index: number;
  urdfContent?: string;
  onUrdfChange?: (newContent: string) => void;
  onRemove: () => void;
  linkData: LinkData;
  meshFiles?: Record<string, Blob>;
  isVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export const CollisionControl = ({
  linkName,
  collision,
  index,
  linkData,
  urdfContent,
  onUrdfChange,
  meshFiles = {},
  onRemove,
  isVisible = false,
  onVisibilityChange,
}: CollisionControlProps) => {
  const [geometryType, setGeometryType] = useState<"box" | "sphere" | "cylinder" | "mesh">(
    collision.geometry.type || "box"
  );
  const [geometryParams, setGeometryParams] = useState(collision.geometry.params || {});
  const [origin, setOrigin] = useState(collision.origin);
  const [isComputing, setIsComputing] = useState(false);
  const [selectedVisualMeshIndex, setSelectedVisualMeshIndex] = useState<number>(0);
  const [calculationInfo, setCalculationInfo] = useState<{
    meshIndex: number;
    meshFilename: string;
    method: string;
    formula?: string;
  } | null>(null);

  const visualMeshInfo = useMemo(() => {
    if (linkData.visuals.length === 0) return null;
    const visualMeshes = linkData.visuals.filter((v) => v.geometry.type === "mesh");
    if (visualMeshes.length === 0) return null;
    return visualMeshes.map((visual) => ({
      filename: visual.geometry.params.filename || "",
      scale: visual.geometry.params.scale || "1 1 1",
      origin: visual.origin,
    }));
  }, [linkData.visuals]);

  const collisionKey = useMemo(() => {
    return `${linkName}-${index}-${collision.geometry.type}-${JSON.stringify(
      collision.geometry.params
    )}-${JSON.stringify(collision.origin)}`;
  }, [linkName, index, collision.geometry.type, collision.geometry.params, collision.origin]);

  useEffect(() => {
    setGeometryType(collision.geometry.type || "box");
    setGeometryParams(collision.geometry.params || {});
    setOrigin(collision.origin);

    if (visualMeshInfo && visualMeshInfo.length > 1 && collision.geometry.type === "mesh") {
      const currentFilename = collision.geometry.params?.filename || "";
      const matchingIndex = visualMeshInfo.findIndex(
        (mesh) =>
          mesh.filename === currentFilename ||
          mesh.filename.split("/").pop() === currentFilename.split("/").pop()
      );
      if (matchingIndex >= 0) {
        setSelectedVisualMeshIndex(matchingIndex);
      }
    }
  }, [collisionKey, visualMeshInfo, collision.geometry.type, collision.geometry.params, collision.origin]);

  const updateURDF = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateCollisionInLink(
      urdfContent,
      linkName,
      index,
      geometryType,
      geometryParams,
      origin
    );
    onUrdfChange(newContent);
  };

  const handleGeometryTypeChange = async (
    newType: "box" | "sphere" | "cylinder" | "mesh"
  ) => {
    setCalculationInfo(null);

    let newParams: Record<string, string> = {};
    let newOrigin = { xyz: [0, 0, 0] as [number, number, number], rpy: [0, 0, 0] as [number, number, number] };

    if (newType === "mesh" && visualMeshInfo && visualMeshInfo.length > 0) {
      const meshIndex = Math.min(selectedVisualMeshIndex, visualMeshInfo.length - 1);
      const selectedMesh = visualMeshInfo[meshIndex];
      newParams = {
        filename: selectedMesh.filename,
        scale: selectedMesh.scale,
      };
      newOrigin = selectedMesh.origin;
    } else if (newType === "box" || newType === "sphere" || newType === "cylinder") {
      if (visualMeshInfo && visualMeshInfo.length > 0) {
        await handleAutoFill(newType);
        return;
      } else {
        if (newType === "box") {
          newParams = {
            size: geometryType === "box" && geometryParams.size ? geometryParams.size : "1 1 1",
          };
        } else if (newType === "sphere") {
          newParams = {
            radius:
              geometryType === "sphere" && geometryParams.radius ? geometryParams.radius : "1",
          };
        } else if (newType === "cylinder") {
          newParams = {
            radius:
              geometryType === "cylinder" && geometryParams.radius
                ? geometryParams.radius
                : "1",
            length:
              geometryType === "cylinder" && geometryParams.length
                ? geometryParams.length
                : "1",
          };
        }
      }
    }

    setGeometryType(newType);
    setGeometryParams(newParams);
    setOrigin(newOrigin);

    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateCollisionInLink(
      urdfContent,
      linkName,
      index,
      newType,
      newParams,
      newOrigin
    );
    onUrdfChange(newContent);
  };

  const handleAutoFill = async (type: "box" | "sphere" | "cylinder" | "capsule") => {
    if (!visualMeshInfo || visualMeshInfo.length === 0 || !onUrdfChange) {
      toast.error("No visual mesh found");
      return;
    }

    setIsComputing(true);
    try {
      const meshIndex = Math.min(selectedVisualMeshIndex, visualMeshInfo.length - 1);
      const selectedMeshInfo = visualMeshInfo[meshIndex];

      const meshFile = findMeshFile(selectedMeshInfo.filename, meshFiles);
      if (!meshFile) {
        toast.error(`Mesh file not found: ${selectedMeshInfo.filename}`);
        setIsComputing(false);
        return;
      }

      const bounds = await computeMeshBounds(meshFile, selectedMeshInfo.scale);
      if (!bounds) {
        toast.error("Failed to compute mesh bounds");
        setIsComputing(false);
        return;
      }

      let newGeometryType: "box" | "sphere" | "cylinder" | "mesh";
      let newGeometryParams: Record<string, string> = {};
      let newOrigin: { xyz: [number, number, number]; rpy: [number, number, number] } = {
        xyz: [0, 0, 0],
        rpy: [0, 0, 0],
      };
      let calculationMethod = "";
      let calculationFormula = "";

      if (type === "box") {
        const visualMeshOrigin = selectedMeshInfo.origin;
        const [rx, ry, rz] = visualMeshOrigin.rpy;
        const [tx, ty, tz] = visualMeshOrigin.xyz;

        const cosRx = Math.cos(rx),
          sinRx = Math.sin(rx);
        const cosRy = Math.cos(ry),
          sinRy = Math.sin(ry);
        const cosRz = Math.cos(rz),
          sinRz = Math.sin(rz);

        const R = [
          [cosRz * cosRy, cosRz * sinRy * sinRx - sinRz * cosRx, cosRz * sinRy * cosRx + sinRz * sinRx],
          [sinRz * cosRy, sinRz * sinRy * sinRx + cosRz * cosRx, sinRz * sinRy * cosRx - cosRz * sinRx],
          [-sinRy, cosRy * sinRx, cosRy * cosRx],
        ];

        const vertexCount = bounds.vertices.length / 3;
        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity;

        for (let i = 0; i < vertexCount; i++) {
          const x = bounds.vertices[i * 3];
          const y = bounds.vertices[i * 3 + 1];
          const z = bounds.vertices[i * 3 + 2];

          const xRot = R[0][0] * x + R[0][1] * y + R[0][2] * z;
          const yRot = R[1][0] * x + R[1][1] * y + R[1][2] * z;
          const zRot = R[2][0] * x + R[2][1] * y + R[2][2] * z;

          const xLink = xRot + tx;
          const yLink = yRot + ty;
          const zLink = zRot + tz;

          minX = Math.min(minX, xLink);
          minY = Math.min(minY, yLink);
          minZ = Math.min(minZ, zLink);
          maxX = Math.max(maxX, xLink);
          maxY = Math.max(maxY, yLink);
          maxZ = Math.max(maxZ, zLink);
        }

        const boxSize: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
        const boxCenter: [number, number, number] = [
          (minX + maxX) / 2,
          (minY + maxY) / 2,
          (minZ + maxZ) / 2,
        ];

        newGeometryType = "box";
        newGeometryParams = {
          size: `${boxSize[0]} ${boxSize[1]} ${boxSize[2]}`,
        };
        newOrigin = {
          xyz: boxCenter,
          rpy: [0, 0, 0],
        };
        calculationMethod = "Axis-Aligned Bounding Box (AABB) in Link Frame";
        calculationFormula =
          "1. Transform mesh vertices by visual origin (xyz + rpy)\n2. Compute AABB in link coordinate frame\n3. size = [max_x - min_x, max_y - min_y, max_z - min_z]\n4. center = [(min_x + max_x)/2, (min_y + max_y)/2, (min_z + max_z)/2]";
      } else if (type === "sphere") {
        const visualMeshOrigin = selectedMeshInfo.origin;
        const [rx, ry, rz] = visualMeshOrigin.rpy;
        const [tx, ty, tz] = visualMeshOrigin.xyz;

        const cosRx = Math.cos(rx),
          sinRx = Math.sin(rx);
        const cosRy = Math.cos(ry),
          sinRy = Math.sin(ry);
        const cosRz = Math.cos(rz),
          sinRz = Math.sin(rz);

        const R = [
          [cosRz * cosRy, cosRz * sinRy * sinRx - sinRz * cosRx, cosRz * sinRy * cosRx + sinRz * sinRx],
          [sinRz * cosRy, sinRz * sinRy * sinRx + cosRz * cosRx, sinRz * sinRy * cosRx - cosRz * sinRx],
          [-sinRy, cosRy * sinRx, cosRy * cosRx],
        ];

        const vertexCount = bounds.vertices.length / 3;
        const transformedVertices: number[] = [];

        for (let i = 0; i < vertexCount; i++) {
          const x = bounds.vertices[i * 3];
          const y = bounds.vertices[i * 3 + 1];
          const z = bounds.vertices[i * 3 + 2];

          const xRot = R[0][0] * x + R[0][1] * y + R[0][2] * z;
          const yRot = R[1][0] * x + R[1][1] * y + R[1][2] * z;
          const zRot = R[2][0] * x + R[2][1] * y + R[2][2] * z;

          transformedVertices.push(xRot + tx, yRot + ty, zRot + tz);
        }

        const transformedVerticesArray = new Float32Array(transformedVertices);

        const pca = computePCA(transformedVerticesArray);
        if (!pca) {
          toast.error("Failed to compute PCA");
          setIsComputing(false);
          return;
        }

        const diagnostics = computeSphereDiagnostics(transformedVerticesArray, pca);

        let centerX: number, centerY: number, centerZ: number;
        let radius: number;
        let methodName: string;
        let formula: string;
        let warning: string | null = null;

        if (diagnostics.isIsotropic) {
          centerX = pca.centroid[0];
          centerY = pca.centroid[1];
          centerZ = pca.centroid[2];
          radius = diagnostics.radialP95;

          methodName = "Robust Sphere (Isotropic)";
          formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
            2
          )} < 2, flatness=${diagnostics.flatness.toFixed(
            2
          )} < 2\n3. Shape is isotropic → sphere is appropriate\n4. Use 95th percentile radius (robust to outliers)`;
        } else if (diagnostics.isElongated) {
          centerX = pca.centroid[0];
          centerY = pca.centroid[1];
          centerZ = pca.centroid[2];
          radius = diagnostics.radialP95;

          methodName = "Robust Sphere (Elongated - Not Ideal)";
          warning = `Shape is elongated (elongation=${diagnostics.elongation.toFixed(
            2
          )}). Consider using cylinder/capsule instead.`;
          formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
            2
          )} > 3 (elongated)\n3. Sphere may not be optimal - consider cylinder\n4. Use 95th percentile radius`;
        } else if (diagnostics.isFlat) {
          centerX = pca.centroid[0];
          centerY = pca.centroid[1];
          centerZ = pca.centroid[2];
          radius = diagnostics.radialP95;

          methodName = "Robust Sphere (Flat - Not Ideal)";
          warning = `Shape is flat (flatness=${diagnostics.flatness.toFixed(
            2
          )}). Consider using box instead.`;
          formula = `1. Transform vertices by visual origin\n2. flatness=${diagnostics.flatness.toFixed(
            2
          )} > 3 (slab-like)\n3. Sphere may not be optimal - consider box\n4. Use 95th percentile radius`;
        } else {
          centerX = pca.centroid[0];
          centerY = pca.centroid[1];
          centerZ = pca.centroid[2];
          radius = diagnostics.radialP95;

          methodName = "Robust Sphere (Moderate Anisotropy)";
          formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
            2
          )}, flatness=${diagnostics.flatness.toFixed(
            2
          )}\n3. Moderate anisotropy - sphere acceptable\n4. Use 95th percentile radius (robust)`;
        }

        if (diagnostics.outlierRatio > 1.3) {
          if (warning) {
            warning += ` High outlier ratio (${diagnostics.outlierRatio.toFixed(
              2
            )}) - may have protrusions.`;
          } else {
            warning = `High outlier ratio (${diagnostics.outlierRatio.toFixed(
              2
            )}) - using robust radius to ignore protrusions.`;
          }
        }

        if (warning) {
          toast.warning(warning, { duration: 5000 });
        }

        newGeometryType = "sphere";
        newGeometryParams = {
          radius: String(radius),
        };
        newOrigin = {
          xyz: [centerX, centerY, centerZ],
          rpy: [0, 0, 0],
        };
        calculationMethod = methodName;
        calculationFormula = formula;
      } else if (type === "cylinder" || type === "capsule") {
        const visualMeshOrigin = selectedMeshInfo.origin;
        const [rx, ry, rz] = visualMeshOrigin.rpy;
        const [tx, ty, tz] = visualMeshOrigin.xyz;

        const cosRx = Math.cos(rx),
          sinRx = Math.sin(rx);
        const cosRy = Math.cos(ry),
          sinRy = Math.sin(ry);
        const cosRz = Math.cos(rz),
          sinRz = Math.sin(rz);

        const R = [
          [cosRz * cosRy, cosRz * sinRy * sinRx - sinRz * cosRx, cosRz * sinRy * cosRx + sinRz * sinRx],
          [sinRz * cosRy, sinRz * sinRy * sinRx + cosRz * cosRx, sinRz * sinRy * cosRx - cosRz * sinRx],
          [-sinRy, cosRy * sinRx, cosRy * cosRx],
        ];

        const vertexCount = bounds.vertices.length / 3;
        const transformedVertices: number[] = [];
        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity;

        for (let i = 0; i < vertexCount; i++) {
          const x = bounds.vertices[i * 3];
          const y = bounds.vertices[i * 3 + 1];
          const z = bounds.vertices[i * 3 + 2];

          const xRot = R[0][0] * x + R[0][1] * y + R[0][2] * z;
          const yRot = R[1][0] * x + R[1][1] * y + R[1][2] * z;
          const zRot = R[2][0] * x + R[2][1] * y + R[2][2] * z;

          const xLink = xRot + tx;
          const yLink = yRot + ty;
          const zLink = zRot + tz;

          transformedVertices.push(xLink, yLink, zLink);

          minX = Math.min(minX, xLink);
          minY = Math.min(minY, yLink);
          minZ = Math.min(minZ, zLink);
          maxX = Math.max(maxX, xLink);
          maxY = Math.max(maxY, yLink);
          maxZ = Math.max(maxZ, zLink);
        }

        const transformedVerticesArray = new Float32Array(transformedVertices);

        const pca = computePCA(transformedVerticesArray);
        if (!pca) {
          toast.error("Failed to compute PCA");
          setIsComputing(false);
          return;
        }

        const diagnostics = computeCylinderDiagnostics(transformedVerticesArray, pca);

        let fitResult: {
          radius: number;
          height: number;
          center: [number, number, number];
          axis: [number, number, number];
        };
        let methodName: string;
        let formula: string;

        if (diagnostics.elongation > 5) {
          if (diagnostics.roundness < 1.2 && diagnostics.outlierRatio < 1.2) {
            const vertexCount = transformedVerticesArray.length / 3;
            const axis = pca.axis;
            const centroid = pca.centroid;

            const tValues: number[] = [];
            for (let i = 0; i < vertexCount; i++) {
              const x = transformedVerticesArray[i * 3] - centroid[0];
              const y = transformedVerticesArray[i * 3 + 1] - centroid[1];
              const z = transformedVerticesArray[i * 3 + 2] - centroid[2];
              const t = x * axis[0] + y * axis[1] + z * axis[2];
              tValues.push(t);
            }

            tValues.sort((a, b) => a - b);
            const height = tValues[tValues.length - 1] - tValues[0];
            const radius = diagnostics.radialP95;

            const centerX =
              centroid[0] + ((tValues[0] + tValues[tValues.length - 1]) / 2) * axis[0];
            const centerY =
              centroid[1] + ((tValues[0] + tValues[tValues.length - 1]) / 2) * axis[1];
            const centerZ =
              centroid[2] + ((tValues[0] + tValues[tValues.length - 1]) / 2) * axis[2];

            fitResult = { radius, height, center: [centerX, centerY, centerZ], axis };
            methodName = "Percentile-based PCA Cylinder";
            formula = `1. Transform vertices by visual origin\n2. Compute PCA diagnostics\n3. elongation=${diagnostics.elongation.toFixed(
              2
            )}, roundness=${diagnostics.roundness.toFixed(
              2
            )}\n4. Use 95th percentile radius (robust)\n5. height = max(t) - min(t) along PCA axis`;
          } else if (diagnostics.roundness > 1.5) {
            const sizeX = maxX - minX;
            const sizeY = maxY - minY;
            const sizeZ = maxZ - minZ;

            let axis: [number, number, number];
            let height: number;

            if (sizeX >= sizeY && sizeX >= sizeZ) {
              axis = [1, 0, 0];
              height = sizeX;
            } else if (sizeY >= sizeX && sizeY >= sizeZ) {
              axis = [0, 1, 0];
              height = sizeY;
            } else {
              axis = [0, 0, 1];
              height = sizeZ;
            }

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const centerZ = (minZ + maxZ) / 2;

            const radialDistances: number[] = [];
            for (let i = 0; i < vertexCount; i++) {
              const x = transformedVertices[i * 3] - centerX;
              const y = transformedVertices[i * 3 + 1] - centerY;
              const z = transformedVertices[i * 3 + 2] - centerZ;

              const t = x * axis[0] + y * axis[1] + z * axis[2];
              const projX = t * axis[0];
              const projY = t * axis[1];
              const projZ = t * axis[2];

              const orthoX = x - projX;
              const orthoY = y - projY;
              const orthoZ = z - projZ;
              const radius = Math.sqrt(orthoX * orthoX + orthoY * orthoY + orthoZ * orthoZ);
              radialDistances.push(radius);
            }

            radialDistances.sort((a, b) => a - b);
            const radius = radialDistances[Math.floor(vertexCount * 0.95)];

            fitResult = { radius, height, center: [centerX, centerY, centerZ], axis };
            methodName = "Constrained Axis Fit (Non-circular)";
            const axisName = axis[0] === 1 ? "X" : axis[1] === 1 ? "Y" : "Z";
            formula = `1. Transform vertices by visual origin\n2. roundness=${diagnostics.roundness.toFixed(
              2
            )} > 1.5 (non-circular)\n3. Use longest AABB dimension: ${axisName}-axis\n4. radius = 95th percentile distance to axis`;
          } else {
            const vertexCount = transformedVerticesArray.length / 3;
            const axis = pca.axis;
            const centroid = pca.centroid;

            const tValues: number[] = [];
            for (let i = 0; i < vertexCount; i++) {
              const x = transformedVerticesArray[i * 3] - centroid[0];
              const y = transformedVerticesArray[i * 3 + 1] - centroid[1];
              const z = transformedVerticesArray[i * 3 + 2] - centroid[2];
              const t = x * axis[0] + y * axis[1] + z * axis[2];
              tValues.push(t);
            }

            tValues.sort((a, b) => a - b);
            const height = tValues[tValues.length - 1] - tValues[0];
            const radius = diagnostics.radialP95;

            const centerX =
              centroid[0] + ((tValues[0] + tValues[tValues.length - 1]) / 2) * axis[0];
            const centerY =
              centroid[1] + ((tValues[0] + tValues[tValues.length - 1]) / 2) * axis[1];
            const centerZ =
              centroid[2] + ((tValues[0] + tValues[tValues.length - 1]) / 2) * axis[2];

            fitResult = { radius, height, center: [centerX, centerY, centerZ], axis };
            methodName = "Percentile PCA (with Outliers)";
            formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
              2
            )} > 5, outlier_ratio=${diagnostics.outlierRatio.toFixed(
              2
            )}\n3. Use 95th percentile radius (robust to outliers)\n4. PCA axis with percentile filtering`;
          }
        } else {
          const sizeX = maxX - minX;
          const sizeY = maxY - minY;
          const sizeZ = maxZ - minZ;

          let axis: [number, number, number];
          let height: number;

          if (sizeX >= sizeY && sizeX >= sizeZ) {
            axis = [1, 0, 0];
            height = sizeX;
          } else if (sizeY >= sizeX && sizeY >= sizeZ) {
            axis = [0, 1, 0];
            height = sizeY;
          } else {
            axis = [0, 0, 1];
            height = sizeZ;
          }

          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          const centerZ = (minZ + maxZ) / 2;

          const radialDistances: number[] = [];
          for (let i = 0; i < vertexCount; i++) {
            const x = transformedVertices[i * 3] - centerX;
            const y = transformedVertices[i * 3 + 1] - centerY;
            const z = transformedVertices[i * 3 + 2] - centerZ;

            const t = x * axis[0] + y * axis[1] + z * axis[2];
            const projX = t * axis[0];
            const projY = t * axis[1];
            const projZ = t * axis[2];

            const orthoX = x - projX;
            const orthoY = y - projY;
            const orthoZ = z - projZ;
            const radius = Math.sqrt(orthoX * orthoX + orthoY * orthoY + orthoZ * orthoZ);
            radialDistances.push(radius);
          }

          radialDistances.sort((a, b) => a - b);
          const radius = radialDistances[Math.floor(vertexCount * 0.95)];

          fitResult = { radius, height, center: [centerX, centerY, centerZ], axis };
          methodName = "Constrained Axis (Low Elongation)";
          const axisName = axis[0] === 1 ? "X" : axis[1] === 1 ? "Y" : "Z";
          formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(
            2
          )} < 5 (not strongly cylindrical)\n3. Use longest AABB dimension: ${axisName}-axis\n4. radius = 95th percentile distance to axis`;
        }

        const rotation = computeRotationToAxis(fitResult.axis);

        newGeometryType = "cylinder";
        newGeometryParams = {
          radius: String(fitResult.radius),
          length: String(fitResult.height),
        };
        calculationMethod = methodName;
        calculationFormula = formula;
        newOrigin = {
          xyz: fitResult.center,
          rpy: rotation.rpy,
        };

        if (type === "capsule") {
          toast.info("Capsule approximated as cylinder in URDF");
        }
      }

      setGeometryType(newGeometryType);
      setGeometryParams(newGeometryParams);
      setOrigin(newOrigin);

      const meshFilename = selectedMeshInfo.filename.split("/").pop() || selectedMeshInfo.filename;
      setCalculationInfo({
        meshIndex,
        meshFilename,
        method: calculationMethod,
        formula: calculationFormula,
      });

      const newContent = updateCollisionInLink(
        urdfContent!,
        linkName,
        index,
        newGeometryType,
        newGeometryParams,
        newOrigin
      );
      onUrdfChange(newContent);

      setIsComputing(false);
      const meshLabel = visualMeshInfo.length > 1 ? ` (from Visual Mesh ${meshIndex + 1})` : "";
      toast.success(`Computed ${type} collision geometry${meshLabel}`);
    } catch (error) {
      console.error("Error auto-filling collision:", error);
      toast.error("Failed to auto-fill collision");
    } finally {
      setIsComputing(false);
    }
  };

  const handleParamChange = (key: string, value: string) => {
    setGeometryParams({ ...geometryParams, [key]: value });
    setCalculationInfo(null);
    setTimeout(updateURDF, 0);
  };

  const handleOriginChange = (field: "xyz" | "rpy", index: number, value: number) => {
    const newOrigin = { ...origin };
    newOrigin[field][index] = value;
    setOrigin(newOrigin);
    setCalculationInfo(null);
    setTimeout(updateURDF, 0);
  };

  const parseSize = (sizeStr: string): [number, number, number] => {
    const parts = sizeStr.split(" ").map(parseFloat);
    return [parts[0] || 1, parts[1] || 1, parts[2] || 1];
  };

  const formatSize = (size: [number, number, number]): string => {
    return `${size[0]} ${size[1]} ${size[2]}`;
  };

  return (
    <BlenderPanel
      title={
        <div className="flex items-center justify-between w-full pr-2">
          <span>Collision {index + 1}</span>
          {onVisibilityChange && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVisibilityChange(!isVisible);
              }}
              className="h-4 w-4 flex items-center justify-center hover:bg-muted/50 rounded transition-colors flex-shrink-0"
              title={isVisible ? "Hide collision in visualizer" : "Show collision in visualizer"}
            >
              {isVisible ? (
                <Eye className="w-3 h-3 text-primary" />
              ) : (
                <EyeOff className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      }
      defaultOpen={false}
      className="mb-0.5"
    >
      <div className="space-y-0.5">
        <BlenderPropertyRow label="Geometry Type">
          <Select value={geometryType} onValueChange={handleGeometryTypeChange}>
            <SelectTrigger className="h-6 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="box">Box</SelectItem>
              <SelectItem value="sphere">Sphere</SelectItem>
              <SelectItem value="cylinder">Cylinder</SelectItem>
              <SelectItem value="mesh">Mesh</SelectItem>
            </SelectContent>
          </Select>
        </BlenderPropertyRow>

        {calculationInfo && (
          <div className="px-1 py-0.5 bg-muted/10 rounded-sm border border-border/15">
            <div className="flex items-start gap-1 mb-0.5">
              <Info className="w-2.5 h-2.5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-semibold text-foreground mb-0.5">
                  Calculated from Mesh
                </div>
                <div className="text-[8px] text-muted-foreground">
                  {visualMeshInfo && visualMeshInfo.length > 1
                    ? `Visual Mesh ${calculationInfo.meshIndex + 1}: ${calculationInfo.meshFilename}`
                    : calculationInfo.meshFilename}
                </div>
              </div>
            </div>
            <div className="px-2.5 space-y-0.5">
              <div className="text-[8px] font-medium text-foreground/90">
                Method: {calculationInfo.method}
              </div>
              {calculationInfo.formula && (
                <div className="text-[7px] text-muted-foreground font-mono bg-background/50 px-1 py-0.5 rounded border border-border/20 whitespace-pre-wrap">
                  {calculationInfo.formula}
                </div>
              )}
            </div>
          </div>
        )}

        {geometryType === "box" && (
          <BlenderPropertyRow label="Size">
            <div className="flex items-center gap-1">
              {parseSize(geometryParams.size || "1 1 1").map((val, i) => (
                <NumberInput
                  key={i}
                  value={val}
                  onValueChange={(newVal) => {
                    const size = parseSize(geometryParams.size || "1 1 1");
                    size[i] = newVal;
                    handleParamChange("size", formatSize(size));
                  }}
                  step={0.01}
                  min={0.001}
                  compact
                  className="w-16"
                />
              ))}
            </div>
          </BlenderPropertyRow>
        )}

        {geometryType === "sphere" && (
          <BlenderPropertyRow label="Radius">
            <NumberInput
              value={parseFloat(geometryParams.radius || "1")}
              onValueChange={(val) => handleParamChange("radius", String(val))}
              step={0.01}
              min={0.001}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>
        )}

        {geometryType === "cylinder" && (
          <>
            <BlenderPropertyRow label="Radius">
              <NumberInput
                value={parseFloat(geometryParams.radius || "1")}
                onValueChange={(val) => handleParamChange("radius", String(val))}
                step={0.01}
                min={0.001}
                compact
                className="w-20"
              />
            </BlenderPropertyRow>
            <BlenderPropertyRow label="Length">
              <NumberInput
                value={parseFloat(geometryParams.length || "1")}
                onValueChange={(val) => handleParamChange("length", String(val))}
                step={0.01}
                min={0.001}
                compact
                className="w-20"
              />
            </BlenderPropertyRow>
          </>
        )}

        {geometryType === "mesh" && (
          <>
            {visualMeshInfo && visualMeshInfo.length > 1 && (
              <BlenderPropertyRow label="Visual Mesh">
                <Select
                  value={String(selectedVisualMeshIndex)}
                  onValueChange={(value) => {
                    const newIndex = parseInt(value, 10);
                    setSelectedVisualMeshIndex(newIndex);
                    const selectedMesh = visualMeshInfo[newIndex];
                    handleParamChange("filename", selectedMesh.filename);
                    handleParamChange("scale", selectedMesh.scale);
                    setOrigin(selectedMesh.origin);
                    updateURDF();
                  }}
                >
                  <SelectTrigger className="h-6 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visualMeshInfo.map((mesh, idx) => (
                      <SelectItem key={idx} value={String(idx)} className="text-[10px]">
                        Visual Mesh {idx + 1}{" "}
                        {mesh.filename ? `(${mesh.filename.split("/").pop()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BlenderPropertyRow>
            )}
            <BlenderPropertyRow label="Filename">
              <Input
                value={geometryParams.filename || ""}
                onChange={(e) => handleParamChange("filename", e.target.value)}
                className="h-6 text-[10px]"
                placeholder="model.stl"
              />
            </BlenderPropertyRow>
            <BlenderPropertyRow label="Scale">
              <div className="flex items-center gap-1">
                {parseSize(geometryParams.scale || "1 1 1").map((val, i) => (
                  <NumberInput
                    key={i}
                    value={val}
                    onValueChange={(newVal) => {
                      const scale = parseSize(geometryParams.scale || "1 1 1");
                      scale[i] = newVal;
                      handleParamChange("scale", formatSize(scale));
                    }}
                    step={0.01}
                    min={0.001}
                    compact
                    className="w-16"
                  />
                ))}
              </div>
            </BlenderPropertyRow>
          </>
        )}

        <BlenderPropertyRow label="Origin XYZ">
          <div className="flex items-center gap-1">
            {origin.xyz.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("xyz", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <div className="flex items-center gap-1">
            {origin.rpy.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("rpy", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        {onUrdfChange && (
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[9px] text-destructive w-full"
              onClick={onRemove}
            >
              <Trash2 className="w-2.5 h-2.5 mr-0.5" />
              Remove
            </Button>
          </div>
        )}
      </div>
    </BlenderPanel>
  );
};
