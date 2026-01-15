import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { toast } from "sonner";
import { useJointStore } from "@/shared/store/useJointStore";
import { useObjectStore, type CreatedObject } from "@/features/objects";
import type { Node, Edge } from "reactflow";
import { getJointLimits, type JointAxisMap, type JointLimits } from "@/features/urdf";
import jointColors from "@/shared/joint_colors.json";
import { AxisGizmo3D } from "@/features/viewer/AxisGizmo3D";
import { CustomAxesHelper } from "@/features/viewer/CustomAxesHelper";
import { CameraIcons } from "@/features/camera/CameraIcons";
import { IKDragControls } from "@/features/viewer/IKDragControls";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import { cn } from "@/shared/lib/utils";
import { useGPUMode, type GPUMode } from "@/shared/hooks/use-gpu-mode";
import type { MeshFiles } from "@/shared/types/feature";
import type { IkResponsePayload } from "@/features/viewer/ik-types";
import { API_BASE_URL } from "@/shared/config/api";
import {
  getDragModeDisplayName,
  resolveJointScalarValue,
  setEmissiveColor,
  type DragMode,
} from "@/features/viewer/viewer-helpers";
import { IK_ORBIT_DEFAULTS } from "@/features/viewer/config";
import { CollisionGeometries } from "@/features/viewer/CollisionGeometries";
import { TrackingLine } from "@/features/viewer/TrackingLine";
import { useAnimationController, type AnimationController } from "@/features/viewer/useAnimationController";
import { useIkSolver } from "@/features/viewer/useIkSolver";
import { useUrdfAnimation } from "@/features/viewer/useUrdfAnimation";
import { useOrbitControlsBindings } from "@/features/viewer/useOrbitControlsBindings";
import { useMotionDataUpload } from "@/features/viewer/useMotionDataUpload";
import { usePlaybackHandlers } from "@/features/viewer/usePlaybackHandlers";
import { useViewerCameraControls } from "@/features/viewer/useViewerCameraControls";
import { usePlaybackNotifications } from "@/features/viewer/usePlaybackNotifications";
import { useViewerWindowBindings } from "@/features/viewer/useViewerWindowBindings";
import { useEndEffectorPoseSync } from "@/features/viewer/useEndEffectorPoseSync";
import { useMeshFilesState } from "@/features/viewer/useMeshFilesState";
import { useRobotBoundingBoxSync } from "@/features/viewer/useRobotBoundingBoxSync";
import { useRobotCameraCentering } from "@/features/viewer/useRobotCameraCentering";
import { useRobotJointSync } from "@/features/viewer/useRobotJointSync";
import { useUrdfFileContent } from "@/features/viewer/useUrdfFileContent";
import { useDragModeEffects } from "@/features/viewer/useDragModeEffects";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import { recordPlaybackTrace, usePlaybackDebugTrace } from "@/shared/debug/playbackTrace";
import { Button } from "@/shared/ui/button";

interface Viewer3DProps {
  urdfFile: File | null;
  initialMeshFiles?: MeshFiles;
  selectedJoint?: string | null;
  selectedLink?: string | null;
  jointValues?: Record<string, number>;
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  onJointSelect?: (jointName: string | null) => void;
  onLinkSelect?: (linkName: string | null) => void;
   onJointHover?: (jointName: string | null) => void;
   onLinkHover?: (linkName: string | null) => void;
  onJointChange?: (jointName: string, value: number) => void;
  onRobotJointsLoaded?: (
    joints: string[],
    angles: Record<string, number>
  ) => void;
  onRobotLoaded?: (robot: URDFRobot | null) => void;
  onMotionDataNodesGenerated?: (nodes: Node[], edges: Edge[]) => void;
  onMotionFileChange?: (file: File | null) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onAnimationFramesChange?: (hasFrames: boolean) => void;
  onFrameChange?: (currentFrame: number, totalFrames?: number) => void;
  collisionVisibility?: CollisionVisibility;
  rotationPlaneVisible?: boolean;
  onRobotBoundingBoxChange?: (boundingBox: THREE.Box3 | null) => void;
  endEffectorLink?: string | null;
  onIkApplied?: (values: Record<string, number>) => void;
}

// Component to render orbit visualization
const OrbitVisualization = ({
  centerPosition,
  radius,
  inclination,
  phase,
  color,
  onPrimaryOrbitClick,
  onSecondaryOrbitClick,
  secondaryPhaseOffsetDeg = IK_ORBIT_DEFAULTS.secondaryOffsetDeg,
}: {
  centerPosition: THREE.Vector3;
  radius: number;
  inclination: number;
  phase: number;
  color: string;
  onPrimaryOrbitClick?: () => void;
  onSecondaryOrbitClick?: () => void;
  secondaryPhaseOffsetDeg?: number;
}) => {
  const TWO_PI = Math.PI * 2;
  const inclinationRad = (inclination * Math.PI) / 180;

  const normalizeAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
  const primaryRad = normalizeAngle((phase * Math.PI) / 180);
  const secondaryRad = normalizeAngle(((phase + secondaryPhaseOffsetDeg) * Math.PI) / 180);

  const getPoint = useCallback(
    (angle: number) => {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const z = y * Math.sin(inclinationRad);
      const yAdjusted = y * Math.cos(inclinationRad);
      return new THREE.Vector3(x, yAdjusted, z);
    },
    [radius, inclinationRad]
  );

  const { solidPositions, hashedPositions } = useMemo(() => {
    const sampleArc = (start: number, end: number, segments: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = segments === 0 ? 0 : i / segments;
        const angle = start + (end - start) * t;
        pts.push(getPoint(angle));
      }
      return pts;
    };

    const rawDiff = (secondaryRad - primaryRad + TWO_PI) % TWO_PI;
    if (rawDiff < 1e-5) {
      const fullPoints = sampleArc(0, TWO_PI, 96);
      return {
        solidPositions: new Float32Array(fullPoints.flatMap((p) => [p.x, p.y, p.z])),
        hashedPositions: new Float32Array(),
      };
    }

    const diff = rawDiff;
    const usePrimaryToSecondary = diff <= Math.PI && diff > 0;

    const solidStart = usePrimaryToSecondary ? primaryRad : secondaryRad;
    const solidEnd = usePrimaryToSecondary ? secondaryRad : primaryRad;
    const solidLength = usePrimaryToSecondary ? diff : TWO_PI - diff;
    const hashedStart = solidEnd;
    const hashedLength = Math.max(0, TWO_PI - solidLength);

    const solidSegCount = Math.max(12, Math.round((solidLength / TWO_PI) * 64));
    const solidPoints = sampleArc(solidStart, solidEnd, solidSegCount);
    const solidFlat = new Float32Array(solidPoints.flatMap((p) => [p.x, p.y, p.z]));

    const hashedFlat = (() => {
      if (hashedLength <= 0.0001) return new Float32Array();
      const dashSegments = Math.max(8, Math.round((hashedLength / TWO_PI) * 48));
      const dashStep = hashedLength / dashSegments;
      const dashFill = 0.55; // fraction of each dash step that is visible
      const positions: number[] = [];

      for (let i = 0; i < dashSegments; i += 2) {
        const startA = hashedStart + dashStep * i;
        const endA = startA + dashStep * dashFill;
        const p1 = getPoint(startA);
        const p2 = getPoint(endA);
        positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }

      return new Float32Array(positions);
    })();

    return { solidPositions: solidFlat, hashedPositions: hashedFlat };
  }, [getPoint, primaryRad, secondaryRad, TWO_PI]);

  // Calculate current position on orbit based on phase
  const orbitTargetPosition = useMemo(() => {
    const phaseRad = (phase * Math.PI) / 180;
    const inclinationRad = (inclination * Math.PI) / 180;

    const x = Math.cos(phaseRad) * radius;
    const y = Math.sin(phaseRad) * radius;
    const z = y * Math.sin(inclinationRad);
    const yAdjusted = y * Math.cos(inclinationRad);

    return new THREE.Vector3(
      centerPosition.x + x,
      centerPosition.y + yAdjusted,
      centerPosition.z + z
    );
  }, [centerPosition, radius, inclination, phase]);

  const secondaryTargetPosition = useMemo(() => {
    const phaseRad = ((phase + secondaryPhaseOffsetDeg) * Math.PI) / 180;
    const inclinationRad = (inclination * Math.PI) / 180;

    const x = Math.cos(phaseRad) * radius;
    const y = Math.sin(phaseRad) * radius;
    const z = y * Math.sin(inclinationRad);
    const yAdjusted = y * Math.cos(inclinationRad);

    return new THREE.Vector3(
      centerPosition.x + x,
      centerPosition.y + yAdjusted,
      centerPosition.z + z
    );
  }, [centerPosition, radius, inclination, phase, secondaryPhaseOffsetDeg]);

  const targetOffset = useMemo<[number, number, number]>(
    () => [
      orbitTargetPosition.x - centerPosition.x,
      orbitTargetPosition.y - centerPosition.y,
      orbitTargetPosition.z - centerPosition.z,
    ],
    [orbitTargetPosition, centerPosition]
  );

  const secondaryTargetOffset = useMemo<[number, number, number]>(
    () => [
      secondaryTargetPosition.x - centerPosition.x,
      secondaryTargetPosition.y - centerPosition.y,
      secondaryTargetPosition.z - centerPosition.z,
    ],
    [secondaryTargetPosition, centerPosition]
  );

  const radiusLinePositions = useMemo(
    () => new Float32Array([0, 0, 0, ...targetOffset]),
    [targetOffset]
  );

  // Force geometry rebuild when orbit params move so the viewer updates immediately
  const orbitGeometryKey = useMemo(
    () => `${radius}-${inclination}-${phase}-${secondaryPhaseOffsetDeg}`,
    [radius, inclination, phase, secondaryPhaseOffsetDeg]
  );
  const radiusLineKey = useMemo(
    () => `${orbitGeometryKey}-${phase}-${targetOffset.join("|")}`,
    [orbitGeometryKey, phase, targetOffset]
  );

  return (
    <group position={[centerPosition.x, centerPosition.y, centerPosition.z]}>
      {/* Orbit circle */}
      <line key={`orbit-${orbitGeometryKey}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={solidPositions.length / 3}
            array={solidPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} opacity={0.6} transparent linewidth={2} />
      </line>

      {/* Hashed (dashed) part */}
      {hashedPositions.length > 0 && (
        <lineSegments key={`orbit-hash-${orbitGeometryKey}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={hashedPositions.length / 3}
              array={hashedPositions}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={color} opacity={0.35} transparent linewidth={1} />
        </lineSegments>
      )}

      {/* Primary target point on orbit */}
      <mesh
        position={targetOffset}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPrimaryOrbitClick?.();
        }}
      >
        <sphereGeometry args={[0.01, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Secondary marker on orbit */}
      <mesh
        position={secondaryTargetOffset}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSecondaryOrbitClick?.();
        }}
      >
        <sphereGeometry args={[0.01, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Line from center to target point */}
      <line key={`orbit-radius-${radiusLineKey}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={radiusLinePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} opacity={0.4} transparent linewidth={1} />
      </line>
    </group>
  );
};

// Component to render created objects and distance lines
const CreatedObjects = ({
  robot,
  gpuMode = "high",
  endEffectorLink = null,
  onIkTargetClick,
}: {
  robot: URDFRobot | null;
  gpuMode?: GPUMode;
  endEffectorLink?: string | null;
  onIkTargetClick?: (obj: CreatedObject) => void;
}) => {
  const objects = useObjectStore((state) => state.objects);
  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const setSelectedObject = useObjectStore((state) => state.setSelectedObject);
  const updateOrbitTargetPoint = useObjectStore((state) => state.updateOrbitTargetPoint);

  // Handle pointer down on cube (just for selection, no dragging)
  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>, objectId: string) => {
    e.stopPropagation();
    const targetObj = objects.find((o) => o.id === objectId);
    setSelectedObject(objectId);
    if (targetObj?.isIkTarget) {
      // If it's an orbit target, set to use center position
      if (targetObj.ikTargetType === "orbit") {
        updateOrbitTargetPoint(objectId, "center");
      }
      if (onIkTargetClick) {
        onIkTargetClick(targetObj);
      }
    }
  }, [objects, onIkTargetClick, setSelectedObject, updateOrbitTargetPoint]);

  return (
    <group>
      {objects.map((obj) => {
        const isSelected = obj.id === selectedObjectId;
        const baseColor = obj.color || "#3b82f6";
        const targetTint = obj.isIkTarget ? "#facc15" : baseColor;

        return (
          <group key={obj.id}>
            {/* Geometry */}
            {obj.type === "point" ? (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  onPointerDown={(e) => handlePointerDown(e, obj.id)}
                >
                  <sphereGeometry args={[Math.max(obj.size.x, obj.size.y, obj.size.z) * 0.5, 18, 12]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isSelected ? 0.95 : 0.85}
                    emissive={isSelected || obj.isIkTarget ? targetTint : "#000000"}
                    emissiveIntensity={isSelected ? 0.4 : obj.isIkTarget ? 0.2 : 0}
                    metalness={0.1}
                    roughness={0.5}
                  />
                </mesh>
                <lineSegments position={[obj.position.x, obj.position.y, obj.position.z]}>
                  <edgesGeometry args={[new THREE.SphereGeometry(Math.max(obj.size.x, obj.size.y, obj.size.z) * 0.5, 12, 8)]} />
                  <lineBasicMaterial color={isSelected ? "#ffffff" : obj.isIkTarget ? "#facc15" : "#aaaaaa"} linewidth={2} />
                </lineSegments>
              </>
            ) : (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  onPointerDown={(e) => handlePointerDown(e, obj.id)}
                >
                  <boxGeometry args={[obj.size.x, obj.size.y, obj.size.z]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isSelected ? 0.8 : 0.6}
                    emissive={isSelected || obj.isIkTarget ? targetTint : "#000000"}
                    emissiveIntensity={isSelected ? 0.3 : obj.isIkTarget ? 0.15 : 0}
                  />
                </mesh>

                {/* Wireframe outline */}
                <lineSegments
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                >
                  <edgesGeometry args={[new THREE.BoxGeometry(obj.size.x, obj.size.y, obj.size.z)]} />
                  <lineBasicMaterial color={isSelected ? "#ffffff" : obj.isIkTarget ? "#facc15" : "#aaaaaa"} linewidth={2} />
                </lineSegments>
              </>
            )}

            {/* Distance visualization line - points to tracked joint center or closest robot point */}
            {robot && endEffectorLink && (obj.trackedJointName || endEffectorLink) && (
              <TrackingLine
                cubePos={obj.position}
                robot={robot}
                trackedJointName={obj.trackedJointName || null}
                endEffectorLink={endEffectorLink}
                gpuMode={gpuMode}
              />
            )}

            {/* Orbit visualization for orbit IK mode */}
            {obj.isIkTarget && obj.ikTargetType === "orbit" && (
              <OrbitVisualization
                centerPosition={obj.position}
                radius={obj.orbitRadius ?? IK_ORBIT_DEFAULTS.radius}
                inclination={obj.orbitInclination ?? IK_ORBIT_DEFAULTS.inclinationDeg}
                phase={obj.orbitPhase ?? IK_ORBIT_DEFAULTS.phaseDeg}
                secondaryPhaseOffsetDeg={
                  obj.orbitSecondaryOffset ?? IK_ORBIT_DEFAULTS.secondaryOffsetDeg
                }
                color={targetTint}
                onPrimaryOrbitClick={() => {
                  setSelectedObject(obj.id);
                  updateOrbitTargetPoint(obj.id, "primary");
                  onIkTargetClick?.(obj);
                }}
                onSecondaryOrbitClick={() => {
                  setSelectedObject(obj.id);
                  updateOrbitTargetPoint(obj.id, "secondary");
                  onIkTargetClick?.(obj);
                }}
              />
            )}
          </group>
        );
      })}
      </group>
    );
  };

  const IKResultDialog = ({
    open,
    running,
    error,
    result,
    targetName,
    isOrbitTarget,
    onClose,
    onApply,
    onFollowOrbit,
  }: {
    open: boolean;
    running: boolean;
    error: string | null;
    result: IkResponsePayload | null;
    targetName: string | null;
    isOrbitTarget: boolean;
    onClose: () => void;
    onApply: () => void;
    onFollowOrbit?: () => void;
  }) => {
    if (!open) return null;

    return (
      <div className="fixed top-4 right-4 z-40 w-96 rounded-lg border border-border bg-background/95 shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">IK Solution</span>
          {targetName && (
            <span className="text-[11px] text-muted-foreground">Target: {targetName}</span>
            )}
          </div>
          <button
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="p-3 space-y-2">
          {running && (
            <div className="text-[12px] text-muted-foreground">Solving IK...</div>
          )}
          {error && (
            <div className="text-[12px] text-destructive">{error}</div>
          )}
          {result && (
            <>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <div className="p-2 rounded border border-border/60">
                  <div className="text-[11px] text-muted-foreground">Validity</div>
                  <div className="font-semibold">{result.diagnostics.validity}</div>
                </div>
                <div className="p-2 rounded border border-border/60">
                  <div className="text-[11px] text-muted-foreground">Stability</div>
                  <div className="font-semibold">{result.diagnostics.stability}</div>
                </div>
                <div className="p-2 rounded border border-border/60">
                  <div className="text-[11px] text-muted-foreground">Degeneracy</div>
                  <div className="font-semibold">{result.diagnostics.degeneracy}</div>
                </div>
                <div className="p-2 rounded border border-border/60">
                  <div className="text-[11px] text-muted-foreground">Branch</div>
                  <div className="font-semibold">
                    {result.diagnostics.branch_maybe ? "Possible switch" : "Likely expected"}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground">
                {result.diagnostics.branch_message}
              </div>

              <div className="text-[11px] text-muted-foreground">
                Cost: {result.diagnostics.cost.toFixed(5)} | Iterations: {result.diagnostics.iterations} | λ:{" "}
                {result.diagnostics.lambda_final.toFixed(3)} | Termination: {result.diagnostics.termination_reason}
              </div>

              <div className="max-h-40 overflow-y-auto border border-border/50 rounded">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-left text-muted-foreground/80">
                      <th className="px-2 py-1 font-normal">Joint</th>
                      <th className="px-2 py-1 font-normal">Value (rad)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.solution).map(([joint, value]) => (
                      <tr key={joint} className="odd:bg-muted/30">
                        <td className="px-2 py-1 whitespace-nowrap">{joint}</td>
                        <td className="px-2 py-1 font-mono">{value.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Dismiss
                </Button>
                <Button size="sm" onClick={onApply}>
                  Apply to robot
                </Button>
                {isOrbitTarget && onFollowOrbit && (
                  <Button size="sm" variant="default" onClick={onFollowOrbit}>
                    Follow Orbit
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const URDFModel = ({
  file,
  meshFiles,
  animationFrames,
  isPlaying,
  onRobotLoaded,
  selectedJoint,
  selectedLink,
  onSelectPart,
  onJointChange,
  onDragActiveChange,
  onFrameChange,
  onPlaybackEnd,
  jointLimits,
  jointAxes,
  gpuMode = "high",
  playbackSpeed = 1.0,
  rotationPlaneVisible = false,
  dragMode = "move-joints",
  animationController,
}: {
  file: File;
  meshFiles: MeshFiles;
  animationFrames: AnimationFrame[] | null;
  isPlaying: boolean;
  onRobotLoaded: (robot: URDFRobot | null) => void;
  selectedJoint?: string | null;
  selectedLink?: string | null;
  onSelectPart?: (payload: {
    linkName?: string;
    jointName?: string | null;
  }) => void;
  onJointChange?: (jointName: string, value: number) => void;
  onDragActiveChange?: (active: boolean) => void;
  onFrameChange?: (frameIndex: number, totalFrames?: number) => void;
  onPlaybackEnd?: (frameIndex: number) => void;
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  gpuMode?: GPUMode;
  playbackSpeed?: number;
  rotationPlaneVisible?: boolean;
  dragMode?: DragMode;
  animationController: AnimationController;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const setAvailableJointsStore = useJointStore((s) => s.setAvailableJoints);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const previewJointValue = useJointStore((s) => s.previewJointValue);
  useUrdfAnimation({
    animationFrames,
    robotRef,
    isPlaying,
    playbackSpeed,
    storeJointValues,
    setStoreJointValues,
    onFrameChange,
    onPlaybackEnd,
    animationController,
  });

  useEffect(() => {
    if (!file) return;

    const blobUrls = blobUrlsRef.current;
    const loader = new URDFLoader();
    const missingMeshes = new Set<string>();

    // Custom mesh loader that uses the uploaded files
    loader.loadMeshCb = (
      path: string,
      manager: THREE.LoadingManager,
      onComplete: (mesh: THREE.Object3D | null, err?: Error) => void
    ) => {
      // Try multiple path variations
      const filename = path.split("/").pop() || path;
      const pathVariations = [
        path, // Full path as-is
        filename, // Just filename
        path.replace(/^.*?\//, ""), // Remove first folder
        path.replace(/^package:\/\/[^/]+\//, ""), // Remove ROS package prefix
        decodeURIComponent(path), // URL decoded
        decodeURIComponent(filename), // URL decoded filename
      ];

      let meshBlob: Blob | null = null;
      for (const variant of pathVariations) {
        if (meshFiles[variant]) {
          meshBlob = meshFiles[variant];
          break;
        }
      }

      if (!meshBlob) {
        const normalizedPath = path
          .replace(/^package:\/\/[^/]+\//, "")
          .replace(/^file:\/\//, "")
          .trim();
        missingMeshes.add(normalizedPath || path);
        // Don't fail - just skip this mesh
        onComplete(null);
        return;
      }

      const blobUrl = URL.createObjectURL(meshBlob);
      blobUrlsRef.current.push(blobUrl);

      const stlLoader = new STLLoader(manager);
      stlLoader.load(
        blobUrl,
        (geometry) => {
          // Choose material based on GPU mode
          const isLowGPU = gpuMode === "low";
          
          // For low-end GPU: skip normal computation (MeshBasicMaterial doesn't need it)
          if (!isLowGPU && !geometry.attributes.normal && geometry.attributes.position) {
            const vertexCount = geometry.attributes.position.count;
            if (vertexCount < 10000) {
              geometry.computeVertexNormals();
            }
          }

          // Use MeshBasicMaterial for low GPU mode, MeshStandardMaterial for high GPU mode
          const defaultMaterial = isLowGPU
            ? new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
            : new THREE.MeshStandardMaterial({
                metalness: 0.3,
                roughness: 0.7,
                side: THREE.DoubleSide,
              });
          const mesh = new THREE.Mesh(geometry, defaultMaterial);
          mesh.castShadow = !isLowGPU;
          mesh.receiveShadow = !isLowGPU;

          // No scaling applied - use URDF geometry as-is

          onComplete(mesh);
        },
        (progress) => {
          // Progress logging removed for performance
        },
        (err) => {
          console.error(`Error loading mesh ${filename}:`, err);
          onComplete(null, err instanceof Error ? err : new Error(String(err)));
        }
      );
    };

    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        // Validate URDF with DOMParser before passing to URDFLoader
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");
        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
          const errorMsg = parserError.textContent || "Invalid URDF XML";
          console.error("URDF parsing error:", errorMsg);
          setError(`URDF parsing error: ${errorMsg}`);
          return;
        }
        
        // Ensure we have a robot element
        const robotElement = xmlDoc.querySelector("robot");
        if (!robotElement) {
          const errorMsg = "No <robot> element found in URDF";
          console.error(errorMsg);
          setError(errorMsg);
          return;
        }
        
        const robot = loader.parse(content) as URDFRobot;
        if (groupRef.current && robot) {
          // Clear previous model
          while (groupRef.current.children.length > 0) {
            groupRef.current.remove(groupRef.current.children[0]);
          }
          groupRef.current.add(robot);

          // PyRoki coordinate system: 1 Three.js unit = 1 meter
          // Robot at world origin with no transforms
          robot.position.set(0, 0, 0);
          robot.rotation.set(0, 0, 0);
          // No scaling applied to robot

          // Calculate bounding box for camera positioning only
          const box = new THREE.Box3().setFromObject(robot);
          const center = box.getCenter(new THREE.Vector3());

          // Store robot center for camera positioning (don't move the robot itself)
          robot.userData.boundingBoxCenter = center.clone();
          robot.userData.isURDFRobot = true;

          robotRef.current = robot;
          onRobotLoaded(robot);

          if (missingMeshes.size > 0) {
            const missingList = Array.from(missingMeshes);
            const preview = missingList.slice(0, 5).join(", ");
            const more =
              missingList.length > 5 ? `, +${missingList.length - 5} more` : "";
            toast.warning(`Missing ${missingList.length} mesh file(s): ${preview}${more}`);
          }
        }
      } catch (err) {
        console.error("Error loading URDF:", err);
        setError("Failed to load URDF file");
        toast.error("Failed to load URDF file");
      }
    };

    reader.readAsText(file);

    // Cleanup blob URLs on unmount
    return () => {
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [file, meshFiles, onRobotLoaded, gpuMode]);

  // ===== Selection & Highlight Helpers =====
  const highlightedMeshesRef = useRef<THREE.Mesh[]>([]);

  const clearHighlights = useCallback(() => {
    highlightedMeshesRef.current.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        setEmissiveColor(material, 0x000000);
        // Note: We keep the cloned material to avoid issues with material sharing
        // The material clone is already in place, just reset emissive
      });
    });
    highlightedMeshesRef.current = [];
  }, []);

  const highlightLink = useCallback((linkName: string, jointName?: string | null) => {
    clearHighlights();
    const robot = robotRef.current;
    if (!robot) return;
    const link = robot.links?.[linkName] ?? robot.getObjectByName?.(linkName);
    if (!link) return;
    
    // Determine highlight color based on joint type from joint_colors.json
    let highlightColor = hexToThreeJsHex(jointColors.light_gray); // Default light gray
    if (jointName && jointLimits) {
      const jointInfo = jointLimits[jointName];
      if (jointInfo && jointInfo.type) {
        const jointType = jointInfo.type as keyof typeof jointColors;
        if (jointColors[jointType]) {
          highlightColor = hexToThreeJsHex(jointColors[jointType]);
        }
      }
    }
    
    // Get all link names to detect when we hit a child link
    const allLinkNames = new Set(Object.keys(robot.links || {}));
    
    // Custom traversal that stops when encountering another link
    const traverseLinkOnly = (obj: THREE.Object3D) => {
      // If this is a mesh, highlight it
      if (obj instanceof THREE.Mesh) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const hasEmissive = materials.some((material) => "emissive" in material);
        if (hasEmissive) {
          const needsClone = materials.some((material) => !material.userData.isHighlighted);
          if (needsClone) {
            const clonedMaterials = materials.map((material) => material.clone());
            obj.material = Array.isArray(obj.material) ? clonedMaterials : clonedMaterials[0];
            clonedMaterials.forEach((material) => {
              material.userData.isHighlighted = true;
              material.userData.originalMesh = obj;
            });
          }
          const activeMaterials = Array.isArray(obj.material) ? obj.material : [obj.material];
          activeMaterials.forEach((material) => {
            setEmissiveColor(material, highlightColor);
          });
          highlightedMeshesRef.current.push(obj);
        }
      }
      
      // Process children, but skip if child is another link
      for (const child of obj.children) {
        // Skip if this child is another link (child link)
        if (allLinkNames.has(child.name)) {
          continue;
        }
        traverseLinkOnly(child);
      }
    };
    
    traverseLinkOnly(link);
  }, [clearHighlights, jointLimits]);

  const getLinkNameForJoint = (jointName: string): string | null => {
    const robot = robotRef.current;
    if (!robot) return null;
    const joint = robot.joints?.[jointName];
    if (!joint) return null;
    const linkNames = new Set(Object.keys(robot.links || {}));
    for (const child of joint.children ?? []) {
      if (linkNames.has(child.name)) return child.name;
    }
    return null;
  };

  // Drag state - using world/floor reference frame
  const draggingJointRef = useRef<string | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ y: number; angle: number; lower: number; upper: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Highlight when external selection changes
  useEffect(() => {
    const robot = robotRef.current;
    if (!robot) return;
    if (selectedJoint) {
      const ln = getLinkNameForJoint(selectedJoint);
      if (ln) highlightLink(ln, selectedJoint);
    } else if (selectedLink) {
      // Highlight the selected link directly
      highlightLink(selectedLink);
    } else {
      clearHighlights();
    }
  }, [selectedJoint, selectedLink, highlightLink, clearHighlights]);

  // Document-level pointer event handlers for dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleDocumentPointerMove = (e: PointerEvent) => {
      const jointName = draggingJointRef.current;
      if (!jointName || !robotRef.current) return;
      const dragStart = dragStartRef.current;
      if (!dragStart) return;
      
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const robot = robotRef.current;
      const joint = robot.joints?.[jointName];
      if (!joint) return;
      
      // Use world/floor reference: vertical mouse movement controls joint angle
      // Map mouse Y movement to joint range: full screen height maps to full joint range
      // This is independent of robot orientation - always uses world coordinates
      const screenHeight = window.innerHeight;
      const dy = dragStart.y - e.clientY; // Inverted: mouse up = positive angle
      
      // Calculate sensitivity: full screen height should cover full joint range
      // Handle unlimited joints (continuous) - use reasonable range for sensitivity calculation
      const isUnlimited = !isFinite(dragStart.lower) || !isFinite(dragStart.upper);
      const effectiveLower = isUnlimited ? -Math.PI * 2 : dragStart.lower;
      const effectiveUpper = isUnlimited ? Math.PI * 2 : dragStart.upper;
      const jointRange = effectiveUpper - effectiveLower;
      const sensitivity = jointRange / screenHeight;
      
      // Calculate new angle based on initial angle + vertical offset
      // Mouse up (negative dy) increases angle, mouse down (positive dy) decreases angle
      const next = dragStart.angle + (dy * sensitivity);
      
      // Clamp to joint limits (only if limits are finite)
      let clampedNext = next;
      if (isFinite(dragStart.lower)) {
        clampedNext = Math.max(dragStart.lower, clampedNext);
      }
      if (isFinite(dragStart.upper)) {
        clampedNext = Math.min(dragStart.upper, clampedNext);
      }
      
      const now =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      const limited = previewJointValue(jointName, clampedNext, now);

      // Set joint value directly - URDF loader handles all parent-child transformations
      // We don't worry about coordinate frames, just the joint value itself
      if (typeof robot.setJointValue === "function") {
        robot.setJointValue(jointName, limited);
      } else if (typeof joint.setJointValue === "function") {
        joint.setJointValue(limited);
      }
      
      // Mark that manual joint changes have been made - this prevents animation from overwriting manual changes
      animationController.markManualJointChange();
      
      // Update store immediately for responsive UI, but effects are skipped during drag
      if (onJointChange) {
        onJointChange(jointName, limited);
      } else {
        setStoreJointValue(jointName, limited, { enforceVelocity: false, timestamp: now });
      }
    };

    const handleDocumentPointerUp = () => {
      if (draggingJointRef.current) {
        draggingJointRef.current = null;
        lastPointerRef.current = null;
        dragStartRef.current = null;
        setIsDragging(false);
        onDragActiveChange?.(false);
      }
    };

    document.addEventListener("pointermove", handleDocumentPointerMove);
    document.addEventListener("pointerup", handleDocumentPointerUp);
    return () => {
      document.removeEventListener("pointermove", handleDocumentPointerMove);
      document.removeEventListener("pointerup", handleDocumentPointerUp);
    };
  }, [
    animationController,
    isDragging,
    onJointChange,
    onDragActiveChange,
    previewJointValue,
    setStoreJointValue,
  ]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const robot = robotRef.current;
    if (!robot) return;
    let obj: THREE.Object3D | null = e.object as THREE.Object3D;
    const linkNames = new Set(Object.keys(robot.links || {}));
    let linkName: string | undefined;
    while (obj) {
      if (linkNames.has(obj.name)) {
        linkName = obj.name;
        break;
      }
      obj = obj.parent;
    }
    let jointName: string | null = null;
    if (linkName) {
      for (const [jName, jObj] of Object.entries(robot.joints ?? {})) {
        if ((jObj.children ?? []).some((child) => child.name === linkName)) {
          jointName = jName;
          break;
        }
      }
      highlightLink(linkName, jointName);
    }
    onSelectPart?.({ linkName, jointName });

    // Start joint drag if joint found and in 'move-joints' mode
    if (jointName && dragMode === 'move-joints') {
      const joint = robot.joints?.[jointName];
      if (joint) {
        // Get joint limits from parsed URDF data
        const limits = getJointLimits(jointLimits, jointName);

        // Read current angle directly from joint
        const currentAngle = resolveJointScalarValue(joint) ?? 0;

        // Store drag start state using world/floor reference (vertical movement)
        dragStartRef.current = {
          y: e.clientY, // Use Y for vertical mouse movement
          angle: currentAngle,
          lower: limits.lower,
          upper: limits.upper
        };

      draggingJointRef.current = jointName;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      setIsDragging(true);
      onDragActiveChange?.(true);
      }
    }
  };

  if (error) {
    return (
      <mesh>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color="red" />
      </mesh>
    );
  }

  return (
    <group
      ref={groupRef}
      onPointerDown={handlePointerDown}
    >
      {rotationPlaneVisible && selectedJoint && jointAxes?.[selectedJoint] && jointLimits?.[selectedJoint] && 
       (jointLimits[selectedJoint].type === "revolute" || jointLimits[selectedJoint].type === "continuous") && (
        <RotationPlane
          robot={robotRef.current}
          jointName={selectedJoint}
          axis={jointAxes[selectedJoint].xyz}
          jointLimits={jointLimits}
          gpuMode={gpuMode}
        />
      )}
    </group>
  );
};

// Rotation plane component that visualizes the plane perpendicular to joint axis
const RotationPlane = ({
  robot,
  jointName,
  axis,
  jointLimits,
  gpuMode = "high",
}: {
  robot: URDFRobot | null;
  jointName: string;
  axis: [number, number, number];
  jointLimits?: JointLimits;
  gpuMode?: GPUMode;
}) => {
  const planeRef = useRef<THREE.Mesh>(null);
  const positionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());
  const defaultNormal = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const fallbackAxis = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const [axisX, axisY, axisZ] = axis;

  // Calculate axis vector and color reactively when axis changes
  const axisVec = useMemo(() => {
    return new THREE.Vector3(axisX, axisY, axisZ).normalize();
  }, [axisX, axisY, axisZ]);
  
  // Determine color based on axis direction (X=red, Y=green, Z=blue) - reactive to axis changes
  const { planeColor, isNegative } = useMemo(() => {
    // Find which axis the joint rotates around (dominant component)
    const absX = Math.abs(axisVec.x);
    const absY = Math.abs(axisVec.y);
    const absZ = Math.abs(axisVec.z);
    
    let color: number;
    let negative = false;
    
    if (absX >= absY && absX >= absZ) {
      // X-axis dominant - Red/Pink
      negative = axisVec.x < 0;
      color = axisVec.x > 0 ? 0xBE2C41 : 0x9A2333; // Red/pink for +X (190, 44, 65), darker for -X
    } else if (absY >= absX && absY >= absZ) {
      // Y-axis dominant - Green
      negative = axisVec.y < 0;
      color = axisVec.y > 0 ? 0x6DA424 : 0x56831C; // Green for +Y (109, 164, 36), darker for -Y
    } else {
      // Z-axis dominant - Blue
      negative = axisVec.z < 0;
      color = axisVec.z > 0 ? 0x3464AD : 0x29508A; // Blue for +Z (52, 100, 173), darker for -Z
    }
    
    return { planeColor: color, isNegative: negative };
  }, [axisVec]);

  // Create striped texture for negative axes (memoized to avoid recreation)
  const stripedTexture = useMemo(() => {
    if (!isNegative) return null;
    
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return null;
    
    // Fill entire canvas with the plane color
    const colorHex = `#${planeColor.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = colorHex;
    ctx.fillRect(0, 0, 64, 64);
    
    // Clear out transparent stripes (every other stripe)
    const stripeWidth = 8;
    for (let i = stripeWidth; i < 64; i += stripeWidth * 2) {
      ctx.clearRect(i, 0, stripeWidth, 64);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }, [isNegative, planeColor]);

  useFrame(() => {
    if (!robot || !planeRef.current) return;

    const joint = robot.joints?.[jointName];
    if (!joint) return;

    // Get joint position in world space
    joint.updateWorldMatrix(true, true);
    joint.getWorldPosition(positionRef.current);
    planeRef.current.position.copy(positionRef.current);

    // Rotate plane so its normal aligns with the joint axis.
    if (Math.abs(axisVec.dot(defaultNormal)) > 0.99) {
      quaternionRef.current.setFromAxisAngle(fallbackAxis, Math.PI / 2);
    } else if (Math.abs(axisVec.dot(defaultNormal)) < -0.99) {
      quaternionRef.current.setFromAxisAngle(fallbackAxis, -Math.PI / 2);
    } else {
      quaternionRef.current.setFromUnitVectors(defaultNormal, axisVec);
    }

    planeRef.current.quaternion.copy(quaternionRef.current);
  });

  // Plane size - make it reasonably sized
  const planeSize = 0.5;

  return (
    <mesh
      ref={planeRef}
      renderOrder={1000}
    >
      <planeGeometry args={[planeSize, planeSize]} />
      {gpuMode === "low" ? (
        <meshBasicMaterial
          color={planeColor}
          opacity={0.2}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          depthTest={false}
          map={stripedTexture || undefined}
        />
      ) : (
        <meshStandardMaterial
          color={planeColor}
          opacity={0.2}
          transparent
          side={THREE.DoubleSide}
          emissive={planeColor}
          emissiveIntensity={0.1}
          depthWrite={false}
          depthTest={false}
          map={stripedTexture || undefined}
        />
      )}
    </mesh>
  );
};

// Infinite grid component - Blender-style grey infinite grid
const InfiniteGrid = ({ gpuMode = "high" }: { gpuMode?: GPUMode }) => {
  // Shader for infinite grid using world space coordinates
  const gridMaterial = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSize1: { value: 1.0 },
        uSize2: { value: 10.0 },
        uColor1: { value: new THREE.Color(0x808080) }, // Main grid lines - grey
        uColor2: { value: new THREE.Color(0x808080) }, // Sub grid lines - same grey
      },
      vertexShader: `
        varying vec3 worldPosition;
        void main() {
          vec3 pos = position.xzy; // Swap Y and Z for Z-up coordinate system
          worldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uSize1;
        uniform float uSize2;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        varying vec3 worldPosition;
        
        void main() {
          // Calculate grid lines in world space
          vec2 coord = worldPosition.xy;
          
          // Main grid (1 unit spacing)
          vec2 grid1 = abs(fract(coord / uSize1 - 0.5) - 0.5);
          grid1 = grid1 / fwidth(coord);
          float line1 = min(grid1.x, grid1.y);
          
          // Sub grid (10 unit spacing)
          vec2 grid2 = abs(fract(coord / uSize2 - 0.5) - 0.5);
          grid2 = grid2 / fwidth(coord);
          float line2 = min(grid2.x, grid2.y);
          
          // Combine grids - main grid is stronger
          float alpha = 1.0 - min(line1, 1.0);
          float alpha2 = 1.0 - min(line2, 1.0);
          alpha = max(alpha, alpha2 * 0.3);
          
          // Apply grey color with appropriate opacity
          gl_FragColor = vec4(uColor1, alpha * 0.5);
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    return material;
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} renderOrder={-1}>
      <planeGeometry args={[10000, 10000]} />
      <primitive object={gridMaterial} attach="material" />
    </mesh>
  );
};

// Helper function to convert hex color string to Three.js hex number
const hexToThreeJsHex = (hex: string): number => {
  // Remove # if present
  const cleanHex = hex.replace("#", "");
  return parseInt(cleanHex, 16);
};

// Helper function to get joint type label (capitalize first letter)
const getJointTypeLabel = (type: string): string => {
  return type.charAt(0).toUpperCase() + type.slice(1);
};

export const Viewer3D = ({
  urdfFile,
  initialMeshFiles = {},
  selectedJoint = null,
  selectedLink: selectedLinkProp = null,
  jointValues = {},
  jointLimits = {},
  jointAxes = {},
  onJointSelect,
  onLinkSelect,
  onJointHover,
  onLinkHover,
  onJointChange,
  onRobotJointsLoaded,
  onRobotLoaded,
  onMotionDataNodesGenerated,
  onMotionFileChange,
  onPlayingChange,
  onAnimationFramesChange,
  onFrameChange,
  collisionVisibility = {},
  rotationPlaneVisible = false,
  onRobotBoundingBoxChange,
  endEffectorLink = null,
  onIkApplied,
}: Viewer3DProps) => {
  // Use GPU mode hook for rendering
  const { gpuMode } = useGPUMode();
  usePlaybackDebugTrace();
  const [, setMotionDataFile] = useState<File | null>(null);
  const [animationFrames, setAnimationFrames] = useState<
    AnimationFrame[] | null
  >(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const { meshFiles } = useMeshFilesState(initialMeshFiles);
  const [isDraggingJoint, setIsDraggingJoint] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const playbackSpeed = useViewerPlaybackStore((state) => state.playbackSpeed);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const animationController = useAnimationController();
  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const setAvailableJointsStore = useJointStore((s) => s.setAvailableJoints);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const { urdfContent } = useUrdfFileContent({
    urdfFile,
    robot,
    onLinkSelect,
    onAutoOpenFk: () => {},
  });
  const endEffectorPose = useEndEffectorPoseSync({
    robot,
    urdfContent,
    endEffectorLink,
    storeJointValues,
    apiBaseUrl: API_BASE_URL,
  });

  // Drag mode state
  const [dragMode, setDragMode] = useState<DragMode>("move-joints");
  const [isDragModeMenuOpen, setIsDragModeMenuOpen] = useState(false);

  const {
    followOrbitIncremental,
    handleIkDragSolved,
    handleIkDragStateChange,
    ikDialogOpen,
    ikDragEnabled,
    ikError,
    ikResult,
    ikTargetName,
    isFollowingOrbit,
    isIkHandleDragging,
    isIkRunning,
    liveIkSeedValues,
    orbitFollowProgress,
    setIkDialogOpen,
    solveIkForObject,
    stopOrbitFollow,
  } = useIkSolver({
    apiBaseUrl: API_BASE_URL,
    dragMode,
    robot,
    urdfContent,
    endEffectorLink,
    onIkApplied,
    onManualJointChange: animationController.markManualJointChange,
  });

  // Use selectedLink from props
  const selectedLink = selectedLinkProp;
  const ikObjects = useObjectStore((state) => state.objects);

  useOrbitControlsBindings({ controlsRef, robot });
  
  useRobotCameraCentering({ robot, controlsRef });
  useRobotBoundingBoxSync({
    robot,
    onRobotBoundingBoxChange,
    onRobotLoaded,
    isDragging: isDraggingJoint || isIkHandleDragging,
  });
  const { resetPose } = useRobotJointSync({
    robot,
    jointValues,
    storeJointValues,
    setStoreJointValues,
    setAvailableJointsStore,
    onRobotJointsLoaded,
    onJointChange,
    isDraggingJoint,
    isIkHandleDragging,
    isPlaying,
    animationController,
  });

  const { handleMotionDataUpload } = useMotionDataUpload({
    robot,
    setAnimationFrames,
    setIsPlaying,
    setMotionDataFile,
    setStoreJointValues,
    onMotionFileChange,
  });
  const {
    handleRun,
    handlePlayEpisode,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
  } = usePlaybackHandlers({
    animationFrames,
    robot,
    isPlaying,
    setIsPlaying,
    setAnimationFrames,
    setCurrentFrame,
    onPlayingChange,
    onFrameChange,
    animationController,
  });
  const {
    cameras,
    selectedCameraId,
    selectCamera,
    isCameraMenuOpen,
    setIsCameraMenuOpen,
    setView,
    handleCameraViewChange,
  } = useViewerCameraControls({
    robot,
    controlsRef,
    cameraRef,
    sceneRef,
  });
  const handlePlaybackEnd = useCallback(
    (frameIndex: number) => {
      recordPlaybackTrace("viewer:playbackEnd", { frameIndex });
      if (!isPlaying) {
        return;
      }
      setIsPlaying(false);
      onPlayingChange?.(false);
      animationController.setPaused(true);
    },
    [animationController, isPlaying, onPlayingChange]
  );

  useViewerWindowBindings({
    handleRun,
    handleMotionDataUpload,
    handlePlayEpisode,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
  });

  useDragModeEffects({
    dragMode,
    isDragModeMenuOpen,
    setIsDragModeMenuOpen,
  });

  usePlaybackNotifications({
    animationFrames,
    isPlaying,
    currentFrame,
    setCurrentFrame,
    onAnimationFramesChange,
    onMotionDataNodesGenerated,
    onPlayingChange,
    onFrameChange,
    onJointChange,
  });

  return (
    <div className="h-full flex flex-col">
      {/* Top Controls */}
      <div className="flex items-center justify-between mb-1.5 px-2">
        <span className="text-xs text-muted-foreground">
          {urdfFile 
            ? `${urdfFile.name.replace(/^viz-/, "")} loaded`
              : "No robot"}
        </span>
      </div>

      {/* 3D Viewer Area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Joint Types Panel - Blender Style */}
        {Object.keys(jointLimits || {}).length > 0 && (() => {
          // Helper to convert hex to rgba
          const hexToRgba = (hex: string, alpha: number) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          };

          // Count joints by type
          const totalJoints = Object.keys(jointLimits || {}).length;
          const typeCounts: Record<string, number> = {};

          Object.values(jointLimits || {}).forEach(j => {
            const type = j?.type || "continuous";
            typeCounts[type] = (typeCounts[type] || 0) + 1;
          });

          // Get all joint types that exist in the robot, ordered by importance (most common first)
          const typeOrder: string[] = ["revolute", "continuous", "prismatic", "fixed", "planar", "floating", "mimic"];
          const existingTypes = Object.keys(typeCounts).sort((a, b) => {
            const aIndex = typeOrder.indexOf(a);
            const bIndex = typeOrder.indexOf(b);
            if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
          });

          return (
          <div className="absolute top-4 left-4 z-10 w-48 bg-background/98 backdrop-blur-sm rounded border border-border/40 shadow-md">
            {/* Header - Compact */}
            <div className="px-2 py-1 border-b border-border/20">
              <div className="text-[9px] font-semibold text-muted-foreground/80 tracking-tight uppercase">
                Joint Types ({totalJoints})
              </div>
            </div>

            {/* Content - Compact */}
            <div className="p-1.5 space-y-1.5">
              {/* Joint Types List - Compact */}
              <div className="space-y-0.5">
                {existingTypes.map((type) => {
                  const count = typeCounts[type];
                  const color = (jointColors as Record<string, string>)[type] || jointColors.light_gray;
                  const isFixed = type === "fixed";
                  const typeJoints = Object.entries(jointLimits || {})
                    .filter(([_, info]) => (info?.type || "continuous") === type)
                    .map(([name]) => name);
                  const isSelected = selectedJoint && typeJoints.includes(selectedJoint);

                  return (
                    <div
                      key={type}
                      className={cn(
                        "flex items-center gap-1.5 px-1 py-0.5 rounded cursor-pointer transition-colors",
                        isSelected
                          ? "bg-primary/15 border border-primary/30"
                          : "hover:bg-muted/15 border border-transparent"
                      )}
                      onClick={() => {
                        if (typeJoints.length > 0 && onJointSelect) {
                          onJointSelect(typeJoints[0]);
                        }
                      }}
                    >
                      <div
                        className="w-2 h-2 rounded-sm border flex-shrink-0"
                        style={{
                          borderColor: color,
                          backgroundColor: isFixed ? color : hexToRgba(color, 0.25)
                        }}
                      />
                      <span className="text-[11px] text-foreground font-medium capitalize flex-1 truncate">
                        {getJointTypeLabel(type)}
                      </span>
                      <span className="text-[9px] text-muted-foreground/70 flex-shrink-0">
                        ({count})
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Selected Link Section */}
              <div className="pt-1.5 border-t border-border/15">
                <div className="text-[9px] font-semibold text-muted-foreground/80 tracking-tight mb-0.5 uppercase">
                  Selected Link
                </div>
                <div className="text-[11px] text-foreground font-medium truncate">
                  {selectedLink || "None"}
                </div>
              </div>

              {/* Associated Joint Section */}
              <div className="pt-1.5 border-t border-border/15">
                <div className="text-[9px] font-semibold text-muted-foreground/80 tracking-tight mb-0.5 uppercase">
                  Associated Joint
                </div>
                <div className="text-[11px] text-foreground font-medium truncate">
                  {selectedJoint || "None"}
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {endEffectorLink && (
          <div className="absolute bottom-4 left-4 z-20 w-72 bg-background/95 backdrop-blur-sm rounded border border-border/40 shadow-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-tight text-muted-foreground/80">
                End Effector
              </div>
              <div className="text-[10px] text-muted-foreground/70 text-right">
                PyRoki = base_link = Three world
              </div>
            </div>
            <div className="text-xs font-semibold text-foreground truncate">{endEffectorLink}</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-foreground">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">PyRoki (m)</div>
                {endEffectorPose.pyroki ? (
                  <div className="font-mono leading-tight space-y-0.5">
                    <div>x: {endEffectorPose.pyroki.position[0].toFixed(4)}</div>
                    <div>y: {endEffectorPose.pyroki.position[1].toFixed(4)}</div>
                    <div>z: {endEffectorPose.pyroki.position[2].toFixed(4)}</div>
                    <div className="text-[10px] text-muted-foreground">wxyz: {endEffectorPose.pyroki.quaternion.map((v) => v.toFixed(3)).join(", ")}</div>
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground">Unavailable</div>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Three.js (m)</div>
                {endEffectorPose.three ? (
                  <div className="font-mono leading-tight space-y-0.5">
                    <div>x: {endEffectorPose.three.position[0].toFixed(4)}</div>
                    <div>y: {endEffectorPose.three.position[1].toFixed(4)}</div>
                    <div>z: {endEffectorPose.three.position[2].toFixed(4)}</div>
                    <div className="text-[10px] text-muted-foreground">wxyz: {endEffectorPose.three.quaternion.map((v) => v.toFixed(3)).join(", ")}</div>
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground">Unavailable</div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                FK mismatch:{" "}
                {endEffectorPose.positionError !== null
                  ? `${endEffectorPose.positionError.toFixed(4)} m`
                  : "--"}
                {endEffectorPose.rotationErrorDeg !== null
                  ? ` | rot ${endEffectorPose.rotationErrorDeg.toFixed(3)}°`
                  : ""}
              </span>
              {endEffectorPose.loading && <span className="text-[10px]">Updating…</span>}
            </div>
            {ikTargetName && (() => {
              const targetObj = ikObjects.find((o) => o.id === ikTargetName);
              if (!targetObj || !endEffectorPose.three) return null;

              // Calculate actual target position based on which point was clicked
              let targetX = targetObj.position.x;
              let targetY = targetObj.position.y;
              let targetZ = targetObj.position.z;

              if (targetObj.ikTargetType === "orbit" && targetObj.orbitTargetPoint !== "center") {
                const radius = targetObj.orbitRadius ?? IK_ORBIT_DEFAULTS.radius;
                const inclination =
                  targetObj.orbitInclination ?? IK_ORBIT_DEFAULTS.inclinationDeg;
                const basePhase = targetObj.orbitPhase ?? IK_ORBIT_DEFAULTS.phaseDeg;

                // Use secondary offset if secondary point was clicked
                const secondaryOffset = targetObj.orbitTargetPoint === "secondary" ? (targetObj.orbitSecondaryOffset ?? 180) : 0;
                const phase = basePhase + secondaryOffset;

                const phaseRad = (phase * Math.PI) / 180;
                const inclinationRad = (inclination * Math.PI) / 180;

                const x = Math.cos(phaseRad) * radius;
                const y = Math.sin(phaseRad) * radius;
                const z = y * Math.sin(inclinationRad);
                const yAdjusted = y * Math.cos(inclinationRad);

                targetX = targetObj.position.x + x;
                targetY = targetObj.position.y + yAdjusted;
                targetZ = targetObj.position.z + z;
              }

              const dx = endEffectorPose.three.position[0] - targetX;
              const dy = endEffectorPose.three.position[1] - targetY;
              const dz = endEffectorPose.three.position[2] - targetZ;
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              return (
                <div className="text-[10px] text-amber-400">
                  EE vs IK target ({ikTargetName}): {dist.toFixed(4)} m
                </div>
              );
            })()}
            {endEffectorPose.error && (
              <div className="text-[10px] text-amber-500">
                {endEffectorPose.error}
              </div>
            )}
          </div>
        )}

        <Canvas
          camera={{ position: [1.5, 1.5, 0.8], fov: 50 }}
          style={{ background: "hsl(var(--background))" }}
          dpr={gpuMode === "low" ? [1, 1.5] : [1, 2]}
          gl={{ 
            antialias: gpuMode === "high",
            powerPreference: gpuMode === "low" ? "low-power" : "high-performance",
            stencil: false,
            depth: true,
            alpha: false
          }}
          onCreated={({ scene, camera, gl }) => {
            // ROS REP-103 / URDF Standard: Z-up coordinate system
            // X=forward (red), Y=left (green), Z=up (blue)
            scene.up.set(0, 0, 1);
            camera.up.set(0, 0, 1);
            cameraRef.current = camera as THREE.PerspectiveCamera;
            sceneRef.current = scene;
            // Expose camera to window for object dragging
            // Configure shadows based on GPU mode
            gl.shadowMap.enabled = gpuMode === "high";
            if (gpuMode === "high") {
              gl.shadowMap.type = THREE.PCFSoftShadowMap;
            }
            // Disable face culling at the WebGL renderer level
            const renderer = gl as THREE.WebGLRenderer;
            const context = renderer.getContext() as WebGLRenderingContext | WebGL2RenderingContext;
            context.disable(context.CULL_FACE);
          }}
        >
          {gpuMode === "low" ? (
            <ambientLight intensity={0.8} />
          ) : (
            <>
              <ambientLight intensity={0.7} />
              <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
              <directionalLight position={[-5, 3, -5]} intensity={0.4} />
              <pointLight position={[0, 5, 0]} intensity={0.5} />
            </>
          )}

          {/* Infinite grid - Blender-style grey infinite grid */}
          <InfiniteGrid gpuMode={gpuMode} />
          
          {/* Floor plane */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow={gpuMode === "high"}>
            <planeGeometry args={[20, 20]} />
            {gpuMode === "low" ? (
              <meshBasicMaterial 
                color={0xfafafa} 
                opacity={0.15} 
                transparent 
                side={THREE.DoubleSide}
              />
            ) : (
              <meshStandardMaterial 
                color={0xfafafa} 
                opacity={0.15} 
                transparent 
                side={THREE.DoubleSide}
              />
            )}
          </mesh>

          {urdfFile && (
            <>
              <URDFModel
                file={urdfFile}
                meshFiles={meshFiles}
                animationFrames={animationFrames}
                isPlaying={isPlaying}
                onRobotLoaded={setRobot}
                selectedJoint={selectedJoint}
                selectedLink={selectedLink}
                jointLimits={jointLimits}
                jointAxes={jointAxes}
                gpuMode={gpuMode}
                playbackSpeed={playbackSpeed}
                rotationPlaneVisible={rotationPlaneVisible}
                dragMode={dragMode}
                animationController={animationController}
                onSelectPart={({ jointName, linkName }) => {
                  // Update selection and highlight
                  onLinkSelect?.(linkName ?? null);
                  onJointSelect?.(jointName ?? null);
                  onLinkHover?.(linkName ?? null);
                  onJointHover?.(jointName ?? null);
                }}
                onJointChange={(j, v) => {
                  if (onJointChange) {
                    onJointChange(j, v);
                  } else {
                    setStoreJointValue(j, v);
                  }
                }}
                onDragActiveChange={setIsDraggingJoint}
                onFrameChange={setCurrentFrame}
                onPlaybackEnd={handlePlaybackEnd}
              />
              <CollisionGeometries
                urdfFile={urdfFile}
                meshFiles={meshFiles}
                collisionVisibility={collisionVisibility}
                robot={robot}
                gpuMode={gpuMode}
              />
              {ikDragEnabled && urdfContent && endEffectorLink && (
                <IKDragControls
                  robot={robot}
                  endEffectorLink={endEffectorLink!}
                  urdfContent={urdfContent!}
                  currentJointValues={liveIkSeedValues}
                  onIkSolved={handleIkDragSolved}
                  onDragStateChange={handleIkDragStateChange}
                  enabled={ikDragEnabled}
                />
              )}
              <CreatedObjects
                robot={robot}
                gpuMode={gpuMode}
                endEffectorLink={endEffectorLink}
                onIkTargetClick={solveIkForObject}
              />
            </>
          )}

          {/* Custom axes helper - solid lines for positive, dots for negative */}
          <CustomAxesHelper size={10} />
          
          {/* Blender-style 3D axis gizmo */}
          <AxisGizmo3D onViewChange={setView} />
          
          {/* Camera icons visualization */}
          {robot && <CameraIcons robot={robot} gpuMode={gpuMode} />}
          
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enabled={!isDraggingJoint && !isIkHandleDragging}
            enablePan={true}
            enableRotate={true}
            enableZoom={true}
            enableDamping={false}
            panSpeed={1.0}
            rotateSpeed={1.0}
            zoomSpeed={1.0}
          />
        </Canvas>

        <IKResultDialog
          open={ikDialogOpen}
          running={isIkRunning}
          error={ikError}
          result={ikResult}
          targetName={ikTargetName}
          isOrbitTarget={
            ikTargetName
              ? useObjectStore.getState().objects.find((o) => o.id === ikTargetName)?.ikTargetType === "orbit"
              : false
          }
          onClose={() => setIkDialogOpen(false)}
          onApply={() => {
            if (ikResult) {
              setStoreJointValues(ikResult.solution);
              onIkApplied?.(ikResult.solution);
              toast.success("Applied IK solution");
            }
          }}
          onFollowOrbit={() => {
            if (ikTargetName && ikResult) {
              followOrbitIncremental(ikTargetName);
            }
          }}
        />

        {/* Drag Mode and Reset Pose buttons in Utils section */}
        {robot && (
          <div className="absolute top-4 right-48 z-20 flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                className="px-3 py-1 text-xs rounded border border-border/60 bg-background/90 text-foreground shadow-sm hover:bg-muted transition-colors flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDragModeMenuOpen((prev) => !prev);
                }}
              >
                <span className="text-muted-foreground text-[10px]">Utils:</span>
                {getDragModeDisplayName(dragMode)}
                <span className="text-[10px] text-muted-foreground">▼</span>
              </button>
              {isDragModeMenuOpen && (
                <div
                  className="absolute right-0 mt-1 w-48 bg-background/95 border border-border/70 rounded shadow-md text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className={cn(
                      "w-full text-left px-3 py-1.5 hover:bg-muted transition-colors",
                      dragMode === 'move-joints' && "bg-muted/70 font-medium"
                    )}
                    onClick={() => {
                      setIsDragModeMenuOpen(false);
                      setDragMode('move-joints');
                    }}
                  >
                    Move Joints
                  </button>
                  <button
                    className={cn(
                      "w-full text-left px-3 py-1.5 hover:bg-muted transition-colors",
                      dragMode === 'click-to-place' && "bg-muted/70 font-medium"
                    )}
                    onClick={() => {
                      setIsDragModeMenuOpen(false);
                      setDragMode('click-to-place');
                    }}
                  >
                    Click-to-place
                  </button>
                  <button
                    className={cn(
                      "w-full text-left px-3 py-1.5 hover:bg-muted transition-colors",
                      dragMode === 'drag-handle' && "bg-muted/70 font-medium"
                    )}
                    onClick={() => {
                      setIsDragModeMenuOpen(false);
                      setDragMode('drag-handle');
                    }}
                  >
                    Drag Handle
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className="px-3 py-1 text-xs rounded border border-border/60 bg-background/90 text-foreground shadow-sm hover:bg-muted transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                resetPose();
              }}
            >
              Reset Pose
            </button>

            {isFollowingOrbit && (
              <button
                type="button"
                className="px-3 py-1 text-xs rounded border border-orange-500/60 bg-orange-500/10 text-orange-600 shadow-sm hover:bg-orange-500/20 transition-colors flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  stopOrbitFollow();
                }}
              >
                Stop Orbit ({orbitFollowProgress.toFixed(0)}%)
              </button>
            )}
          </div>
        )}

        {/* Camera POV button (mirror gizmo camera circle) */}
        {robot && cameras.length > 0 && (
          <div className="absolute top-4 right-4 z-20">
            <div className="relative">
              <button
                type="button"
                className="px-3 py-1 text-xs rounded border border-border/60 bg-background/90 text-foreground shadow-sm hover:bg-muted transition-colors flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCameraMenuOpen((prev) => !prev);
                }}
              >
                {cameras.find((c) => c.id === selectedCameraId)?.name ?? cameras[0].name}
                <span className="text-[10px] text-muted-foreground">▼</span>
              </button>
              {isCameraMenuOpen && (
                <div
                  className="absolute right-0 mt-1 w-44 bg-background/95 border border-border/70 rounded shadow-md text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  {cameras.map((camera) => (
                    <button
                      key={camera.id}
                      className={cn(
                        "w-full text-left px-3 py-1 hover:bg-muted transition-colors",
                        selectedCameraId === camera.id && "bg-muted/70 font-medium"
                      )}
                      onClick={() => {
                        setIsCameraMenuOpen(false);
                        selectCamera(camera.id);
                        handleCameraViewChange(camera.id);
                      }}
                    >
                      {camera.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!urdfFile && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-muted-foreground/60">
              Upload URDF to view model
            </span>
          </div>
        )}

      </div>

    </div>
  );
};
