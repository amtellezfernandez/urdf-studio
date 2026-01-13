import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { toast } from "sonner";
import { useJointStore } from "@/store/useJointStore";
import { useObjectStore, type CreatedObject } from "@/features/object-creator";
import type { Node, Edge } from "reactflow";
import { getJointLimits, type JointAxisMap, type JointLimits } from "@/features/urdf";
import jointColors from "@/joint_colors.json";
import { AxisGizmo3D } from "@/components/AxisGizmo3D";
import { CustomAxesHelper } from "@/components/CustomAxesHelper";
import { CameraIcons } from "@/components/CameraIcons";
import { IKDragControls } from "@/components/IKDragControls";
import { useCameraStore } from "@/store/useCameraStore";
import { parseEpisodeCsv, parseEpisodeJson } from "@/features/dataset";
import type { CollisionVisibility } from "@/components/LinkEditor";
import { cn } from "@/lib/utils";
import { applyJointValues } from "@/lib/urdf-joints";
import { useGPUMode, type GPUMode } from "@/hooks/use-gpu-mode";
import type { MeshFiles, WindowWithViewerHandlers } from "@/features/types";
import type { IkResponsePayload } from "@/components/viewer3d/ik-types";
import {
  extractLinkPose,
  getDragModeDisplayName,
  getLiveRobotJoints,
  hasJointMapChanged,
  positionDistance,
  quaternionAngularErrorDeg,
  resolveJointScalarValue,
  setEmissiveColor,
  toZeroIfTiny,
  type DragMode,
  type LinkPose,
} from "@/components/viewer3d/viewer3d-helpers";
import { CollisionGeometries } from "@/components/viewer3d/CollisionGeometries";
import { TrackingLine } from "@/components/viewer3d/TrackingLine";
import { useIkSolver } from "@/components/viewer3d/useIkSolver";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";

const API_BASE_URL = "http://localhost:8000";

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

interface AnimationFrame {
  timestamp: number;
  joints: Record<string, number>;
}

type EndEffectorPoseState = {
  pyroki: LinkPose | null;
  three: LinkPose | null;
  positionError: number | null;
  rotationErrorDeg: number | null;
  error: string | null;
  lastUpdated: number | null;
  loading: boolean;
};

type MouseButtonsWithOriginal = OrbitControlsImpl["mouseButtons"] & {
  _originalMiddle?: THREE.MOUSE;
};

// Component to render orbit visualization
const OrbitVisualization = ({
  centerPosition,
  radius,
  inclination,
  phase,
  color,
  onPrimaryOrbitClick,
  onSecondaryOrbitClick,
  secondaryPhaseOffsetDeg = 180,
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
                radius={obj.orbitRadius ?? 0.3}
                inclination={obj.orbitInclination ?? 45}
                phase={obj.orbitPhase ?? 0}
                secondaryPhaseOffsetDeg={obj.orbitSecondaryOffset ?? 180}
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

  interface FKLinkError {
    linkName: string;
    positionError: number;
    rotationErrorDeg: number;
    pyrokiPosition: { x: number; y: number; z: number };
    urdfPosition: { x: number; y: number; z: number };
    pyrokiQuat: { w: number; x: number; y: number; z: number };
    urdfQuat: { w: number; x: number; y: number; z: number };
  }
  
  interface FKValidationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    urdfContent: string | null;
    robot: URDFRobot | null;
  }
  
  const FKValidationDialog = ({
    open,
    onOpenChange,
    urdfContent,
    robot,
  }: FKValidationDialogProps) => {
    const jointValues = useJointStore((s) => s.jointValues);
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<{
      maxPositionError: number;
      maxRotationErrorDeg: number;
      perLink: FKLinkError[];
    } | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const latestRequestId = useRef(0);

    // Draggable state
    const [position, setPosition] = useState({ x: 100, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const panelRef = useRef<HTMLDivElement>(null);

    // Expanded link state for showing detailed values
    const [expandedLink, setExpandedLink] = useState<string | null>(null);
  
    const computeComparison = useCallback(async () => {
      if (!open) return;
      if (!urdfContent || !robot) {
        setError("Missing URDF content or robot model for FK validation.");
        return;
      }
  
      const requestId = ++latestRequestId.current;
      setIsChecking(true);
      setError(null);
  
      try {
        const response = await fetch(`${API_BASE_URL}/pyroki/fk`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            urdf: urdfContent,
            joint_values: jointValues,
          }),
        });
  
        if (!response.ok) {
          let message = "PyRoki FK API request failed";
          try {
            const data = await response.json();
            message =
              data.error || data.detail || data.message || message;
          } catch {
            // Ignore JSON parse errors
          }
          if (requestId === latestRequestId.current) {
            setError(message);
            setSummary(null);
          }
          return;
        }
  
        const data = await response.json();
        if (requestId !== latestRequestId.current) {
          // A newer request finished after this one; ignore stale result
          return;
        }
  
        const links = Array.isArray(data.links) ? data.links : [];
        const pyrokiByName: Record<
          string,
          { position: number[]; quaternion_wxyz: number[] }
        > = {};
        for (const link of links) {
          if (
            typeof link?.name === "string" &&
            Array.isArray(link.position) &&
            Array.isArray(link.quaternion_wxyz)
          ) {
            pyrokiByName[link.name] = {
              position: link.position,
              quaternion_wxyz: link.quaternion_wxyz,
            };
          }
        }
  
        const robotAny = robot;
        if (robotAny.updateMatrixWorld) {
          robotAny.updateMatrixWorld(true);
        }

        const threeLinks = robotAny.links || {};
        const linkNames = Object.keys(threeLinks);
  
        const tmpMatrix = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
  
        const perLink: FKLinkError[] = [];
        let maxPositionError = 0;
        let maxRotationErrorDeg = 0;
  
        for (const linkName of linkNames) {
          const obj = threeLinks[linkName];
          if (!obj || !obj.matrixWorld) continue;
          tmpMatrix.copy(obj.matrixWorld);
          tmpMatrix.decompose(pos, quat, scale);
  
          const pyrokiLink = pyrokiByName[linkName];
          if (!pyrokiLink) continue;
  
          const [px, py, pz] = pyrokiLink.position ?? [];
          const [w, x, y, z] = pyrokiLink.quaternion_wxyz ?? [];
          if (
            typeof px !== "number" ||
            typeof py !== "number" ||
            typeof pz !== "number" ||
            typeof w !== "number" ||
            typeof x !== "number" ||
            typeof y !== "number" ||
            typeof z !== "number"
          ) {
            continue;
          }
  
          // PyRoki coordinates are directly in Three.js scene coordinates (meters)
          const pxScene = px;
          const pyScene = py;
          const pzScene = pz;
  
          const dx = pos.x - pxScene;
          const dy = pos.y - pyScene;
          const dz = pos.z - pzScene;
          const positionError = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
          // Convert PyRoki quaternion (w,x,y,z) to Three.js (x,y,z,w)
          const pyrokiQuat = new THREE.Quaternion(x, y, z, w);

          // Compute dot product to handle quaternion sign ambiguity
          // q and -q represent the same rotation, so use shortest path
          const dot = quat.x * pyrokiQuat.x + quat.y * pyrokiQuat.y +
                      quat.z * pyrokiQuat.z + quat.w * pyrokiQuat.w;

          // Use absolute value of dot product for shortest angular distance
          const absDot = Math.abs(dot);
          const clampedDot = Math.min(1, Math.max(-1, absDot));
          const angleRad = 2 * Math.acos(clampedDot);
          const rotationErrorDeg = (angleRad * 180) / Math.PI;
  
          maxPositionError = Math.max(maxPositionError, positionError);
          maxRotationErrorDeg = Math.max(maxRotationErrorDeg, rotationErrorDeg);

          perLink.push({
            linkName,
            positionError,
            rotationErrorDeg,
            pyrokiPosition: { x: pxScene, y: pyScene, z: pzScene },
            urdfPosition: { x: pos.x, y: pos.y, z: pos.z },
            pyrokiQuat: { w, x, y, z },
            urdfQuat: { w: quat.w, x: quat.x, y: quat.y, z: quat.z },
          });
        }
  
        perLink.sort(
          (a, b) => b.positionError - a.positionError || b.rotationErrorDeg - a.rotationErrorDeg
        );
  
        setSummary({
          maxPositionError,
          maxRotationErrorDeg,
          perLink,
        });
        setLastUpdated(new Date());
      } catch (err) {
        if (requestId === latestRequestId.current) {
          setError(
            err instanceof Error
              ? err.message
              : "Unknown error while running PyRoki FK comparison"
          );
          setSummary(null);
        }
      } finally {
        if (requestId === latestRequestId.current) {
          setIsChecking(false);
        }
      }
    }, [open, urdfContent, robot, jointValues]);
  
    // Debounced real-time comparison while the dialog is open and joints change.
    useEffect(() => {
      if (!open) return;
      const handle = setTimeout(() => {
        void computeComparison();
      }, 150);
      return () => clearTimeout(handle);
    }, [open, jointValues, computeComparison]);

    // Drag handlers
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };

    useEffect(() => {
      if (!isDragging) return;

      const handleMouseMove = (e: MouseEvent) => {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [isDragging, dragOffset]);

    if (!open) return null;
  
    return (
      <div
        ref={panelRef}
        className="fixed bg-background border rounded-lg shadow-lg z-50"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '600px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Draggable header */}
        <div
          className="flex items-center justify-between p-3 border-b cursor-move select-none bg-muted/50"
          onMouseDown={handleMouseDown}
        >
          <div className="flex-1">
            <h3 className="font-semibold text-sm">PyRoki vs URDFLoader FK</h3>
            <p className="text-xs text-muted-foreground">
              Compare forward kinematics in real time
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onOpenChange(false)}
          >
            ✕
          </Button>
        </div>

        {/* Content area */}
        <div className="p-4 overflow-auto flex-1">
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>PyRoki FK error</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap text-xs">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {!error && summary && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>
                  Max position error:{" "}
                  {(summary.maxPositionError * 1000).toFixed(2)} mm · Max rotation
                  error: {summary.maxRotationErrorDeg.toFixed(2)}°
                  {lastUpdated
                    ? ` · Updated at ${lastUpdated.toLocaleTimeString()}`
                    : null}
                </span>
              </div>

              <div className="border rounded-md p-2 max-h-96 overflow-auto text-xs">
                <div className="font-medium mb-2 text-muted-foreground">
                  Link Comparison (top 10 by position error)
                </div>
                {summary.perLink.length === 0 && (
                  <div className="text-muted-foreground">
                    No overlapping link names between PyRoki and URDFLoader.
                  </div>
                )}
                {summary.perLink.slice(0, 10).map((item) => (
                  <div key={item.linkName} className="mb-3 border border-border rounded p-2">
                    <div
                      className="flex items-center justify-between cursor-pointer hover:bg-muted/50 p-1 rounded mb-2"
                      onClick={() => setExpandedLink(expandedLink === item.linkName ? null : item.linkName)}
                    >
                      <span className="font-mono mr-2 truncate flex items-center gap-1">
                        <span className="text-muted-foreground">{expandedLink === item.linkName ? '▼' : '▶'}</span>
                        <span className="font-semibold">{item.linkName}</span>
                      </span>
                      <span className="text-right whitespace-nowrap text-xs">
                        Δ {(item.positionError * 1000).toFixed(2)} mm ·{" "}
                        {item.rotationErrorDeg.toFixed(2)}°
                      </span>
                    </div>

                    {/* Always show coordinates */}
                    <div className="ml-4 text-[10px] space-y-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="font-semibold text-emerald-600 mb-0.5">PyRoki (m)</div>
                          <div className="font-mono text-[9px] leading-tight">
                            x: {item.pyrokiPosition.x.toFixed(4)}
                          </div>
                          <div className="font-mono text-[9px] leading-tight">
                            y: {item.pyrokiPosition.y.toFixed(4)}
                          </div>
                          <div className="font-mono text-[9px] leading-tight">
                            z: {item.pyrokiPosition.z.toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div className="font-semibold text-blue-600 mb-0.5">Three.js (m)</div>
                          <div className="font-mono text-[9px] leading-tight">
                            x: {item.urdfPosition.x.toFixed(4)}
                          </div>
                          <div className="font-mono text-[9px] leading-tight">
                            y: {item.urdfPosition.y.toFixed(4)}
                          </div>
                          <div className="font-mono text-[9px] leading-tight">
                            z: {item.urdfPosition.z.toFixed(4)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expanded view shows quaternions */}
                    {expandedLink === item.linkName && (
                      <div className="ml-4 mt-2 p-2 bg-muted/30 rounded text-[10px] space-y-1">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="font-semibold text-emerald-600 mb-1">PyRoki Quat</div>
                            <div className="font-mono text-[9px]">
                              w: {item.pyrokiQuat.w.toFixed(4)}
                            </div>
                            <div className="font-mono text-[9px]">
                              x: {item.pyrokiQuat.x.toFixed(4)}
                            </div>
                            <div className="font-mono text-[9px]">
                              y: {item.pyrokiQuat.y.toFixed(4)}
                            </div>
                            <div className="font-mono text-[9px]">
                              z: {item.pyrokiQuat.z.toFixed(4)}
                            </div>
                          </div>
                          <div>
                            <div className="font-semibold text-blue-600 mb-1">Three.js Quat</div>
                            <div className="font-mono text-[9px]">
                              w: {item.urdfQuat.w.toFixed(4)}
                            </div>
                            <div className="font-mono text-[9px]">
                              x: {item.urdfQuat.x.toFixed(4)}
                            </div>
                            <div className="font-mono text-[9px]">
                              y: {item.urdfQuat.y.toFixed(4)}
                            </div>
                            <div className="font-mono text-[9px]">
                              z: {item.urdfQuat.z.toFixed(4)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void computeComparison();
              }}
              disabled={isChecking || !urdfContent || !robot}
            >
              {isChecking ? "Recomputing..." : "Recompute now"}
            </Button>
          </div>
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
  jointLimits,
  jointAxes,
  gpuMode = "high",
  playbackSpeed = 1.0,
  rotationPlaneVisible = false,
  dragMode = "move-joints",
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
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  gpuMode?: GPUMode;
  playbackSpeed?: number;
  rotationPlaneVisible?: boolean;
  dragMode?: DragMode;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const animationStartTime = useRef<number>(0);
  const manualFrameTimeRef = useRef<number | null>(null); // For manual frame navigation
  const blobUrlsRef = useRef<string[]>([]);
  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const setAvailableJointsStore = useJointStore((s) => s.setAvailableJoints);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const previewJointValue = useJointStore((s) => s.previewJointValue);
  const currentFrameIndexRef = useRef<number>(0);
  const hasManualJointChangesRef = useRef<boolean>(false); // Track if user has manually changed joints

  // Reset animation when frames change
  useEffect(() => {
    if (animationFrames) {
      animationStartTime.current = 0;
      currentFrameIndexRef.current = 0;
    }
  }, [animationFrames]);

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

  // Animation loop
  useFrame(() => {
    if (
      !animationFrames ||
      !robotRef.current ||
      animationFrames.length === 0
    ) {
      return;
    }

    const firstTimestamp = animationFrames[0].timestamp;
    const lastTimestamp = animationFrames[animationFrames.length - 1].timestamp;
    const animationDuration = lastTimestamp - firstTimestamp;
    
    // Normalize timestamps to be evenly spaced for uniform playback
    // This prevents lags when frames have uneven timestamp intervals
    const normalizedFrameDuration = animationDuration / Math.max(1, animationFrames.length - 1);
    const normalizedLastTimestamp = firstTimestamp + (animationFrames.length - 1) * normalizedFrameDuration;

    let currentTime: number;
    let shouldApplyAnimation = false; // Flag to determine if we should apply animation values

    // Check for preserved frame time from stop handler (set when stopping to preserve position)
    // This MUST be checked first to prevent jumping to frame 0 when stopping
    const preservedFrameTime = (window as WindowWithViewerHandlers).__viewer3dPreserveFrameTime;
    if (preservedFrameTime !== undefined && preservedFrameTime !== null) {
      // Use preserved frame time and convert to normalized time
      const frameIndex = Math.round((preservedFrameTime - firstTimestamp) / normalizedFrameDuration);
      const clampedFrameIndex = Math.max(0, Math.min(frameIndex, animationFrames.length - 1));
      const normalizedTime = firstTimestamp + clampedFrameIndex * normalizedFrameDuration;
      currentTime = normalizedTime;
      manualFrameTimeRef.current = normalizedTime;
      // Update frame index immediately to prevent wrong frame from being displayed
      (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = clampedFrameIndex;
      currentFrameIndexRef.current = clampedFrameIndex;
      // Immediately update frame callback with correct frame to prevent UI flicker
      if (onFrameChange) {
        onFrameChange(clampedFrameIndex);
      }
      // Clear the window property after using it
      delete (window as WindowWithViewerHandlers).__viewer3dPreserveFrameTime;
      shouldApplyAnimation = true;
      // Set a flag to skip the normal frame update logic below
      (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate = true;
    }
    
    // Check for manual frame time from window (set by handleSetFrame or timeline scrubbing)
    const manualFrameTime = (window as WindowWithViewerHandlers).__viewer3dManualFrameTime;
    if (manualFrameTime !== undefined && manualFrameTime !== null) {
      // When manually setting a frame, find the frame index from the timestamp
      // Then convert to normalized time for uniform playback
      let targetFrameIndex = animationFrames.length - 1;
      for (let i = 0; i < animationFrames.length; i++) {
        if (animationFrames[i].timestamp >= manualFrameTime) {
          targetFrameIndex = i;
          break;
        }
      }
      // Convert to normalized time
      const normalizedTime = firstTimestamp + targetFrameIndex * normalizedFrameDuration;
      currentTime = normalizedTime;
      manualFrameTimeRef.current = normalizedTime;
      // Update frame index immediately
      (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = targetFrameIndex;
      currentFrameIndexRef.current = targetFrameIndex;
      // Immediately update frame callback to prevent UI from showing wrong frame
      if (onFrameChange) {
        onFrameChange(targetFrameIndex);
      }
      // Update animation start time to maintain position when playing resumes
      // But only if we're going to play - if paused, don't update it
      if (isPlaying) {
        animationStartTime.current = Date.now() - (normalizedTime - firstTimestamp) / playbackSpeed;
      } else {
        // When paused, don't update animationStartTime - keep it as is
        // This prevents the frame from jumping when manually set
      }
      // Clear the window property after using it
      delete (window as WindowWithViewerHandlers).__viewer3dManualFrameTime;
      shouldApplyAnimation = true; // Apply when manually setting frame
      // Set pause flag to prevent interpolation
      (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
      // Set flag to skip normal frame update
      (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate = true;
    } else if (manualFrameTimeRef.current !== null) {
      // Use stored manual frame time (paused at a specific frame)
      currentTime = manualFrameTimeRef.current;
      // Calculate frame index from stored time to keep it consistent
      const storedFrameIndex = Math.round((currentTime - firstTimestamp) / normalizedFrameDuration);
      const clampedStoredIndex = Math.max(0, Math.min(storedFrameIndex, animationFrames.length - 1));
      (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = clampedStoredIndex;
      // If we start playing from a paused state, update start time and clear manual frame
      if (isPlaying) {
        // The stored time is already normalized, so use it directly
        animationStartTime.current = Date.now() - (currentTime - firstTimestamp) / playbackSpeed;
        manualFrameTimeRef.current = null;
        shouldApplyAnimation = true;
        // Clear pause flag when starting to play
        delete (window as WindowWithViewerHandlers).__viewer3dIsPaused;
      } else {
        // Paused with manual frame time - stay at this exact frame (no interpolation)
        shouldApplyAnimation = true;
        // Store a flag to indicate we're paused so we don't interpolate
        (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
        // Set flag to skip normal frame update to prevent recalculation
        (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate = true;
      }
    } else if (isPlaying) {
      // Normal playback - use normalized timing for uniform playback
      shouldApplyAnimation = true;
      // Clear pause flag when playing
      delete (window as WindowWithViewerHandlers).__viewer3dIsPaused;
      // Clear manual joint changes flag when playing - allow animation to take control
      hasManualJointChangesRef.current = false;
      delete (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges;
      
      // Check if we need to reset animation start time (when starting from last frame)
      const shouldResetStartTime = (window as WindowWithViewerHandlers).__viewer3dResetAnimationStartTime;
      if (shouldResetStartTime) {
        animationStartTime.current = 0;
        delete (window as WindowWithViewerHandlers).__viewer3dResetAnimationStartTime;
      }
      
      if (animationStartTime.current === 0) {
        // First time playing - start from the beginning
        animationStartTime.current = Date.now();
      }
      const elapsed = Date.now() - animationStartTime.current;
      const speedAdjustedElapsed = elapsed * playbackSpeed;

      // Use normalized duration for uniform playback
      const normalizedDuration = normalizedLastTimestamp - firstTimestamp;
      if (normalizedDuration > 0) {
        // Don't loop - stop at the last frame
        const calculatedTime = firstTimestamp + speedAdjustedElapsed;
        if (calculatedTime >= normalizedLastTimestamp) {
          // Reached the last frame - stop playing but keep position
          currentTime = normalizedLastTimestamp;
          // Calculate and set the last frame index immediately
          const lastFrameIndex = animationFrames.length - 1;
          (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = lastFrameIndex;
          currentFrameIndexRef.current = lastFrameIndex;
          // Store the last frame time so we stay at this position
          manualFrameTimeRef.current = normalizedLastTimestamp;
          // Set pause flag to prevent interpolation
          (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
          // Update frame callback immediately to reflect last frame
          if (onFrameChange) {
            onFrameChange(lastFrameIndex);
          }
          // Stop playback using the window-based handler (will preserve last frame position)
          // Use requestAnimationFrame to ensure this happens after current frame is applied
          requestAnimationFrame(() => {
            (window as WindowWithViewerHandlers).viewer3dStopAnimation?.();
          });
        } else {
          currentTime = calculatedTime;
        }
      } else {
        currentTime = firstTimestamp;
      }
    } else {
      // Paused and no manual frame time - preserve current position
      // Use current frame index if available to prevent jumping to frame 0/1
      const currentFrameIdx = (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex;
      if (currentFrameIdx !== undefined && currentFrameIdx !== null && currentFrameIdx >= 0) {
        // Use the current frame index to calculate normalized time
        const normalizedTime = firstTimestamp + currentFrameIdx * normalizedFrameDuration;
        currentTime = normalizedTime;
        manualFrameTimeRef.current = normalizedTime;
        shouldApplyAnimation = true;
      } else if (animationStartTime.current !== 0) {
        // Calculate current time from animation start time
        const elapsed = Date.now() - animationStartTime.current;
        const speedAdjustedElapsed = elapsed * playbackSpeed;
        const normalizedDuration = normalizedLastTimestamp - firstTimestamp;
        if (normalizedDuration > 0) {
          currentTime = firstTimestamp + (speedAdjustedElapsed % normalizedDuration);
        } else {
          currentTime = firstTimestamp;
        }
        // Store this as manual frame time so we stay at this position
        manualFrameTimeRef.current = currentTime;
        shouldApplyAnimation = true;
      } else {
        // No animation start time and no current frame index - stay at frame 0
        currentTime = firstTimestamp;
        manualFrameTimeRef.current = currentTime;
        (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = 0;
        shouldApplyAnimation = true;
      }
      // Set pause flag
      (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
    }
    
    // Find the appropriate frame or interpolate
    // Use normalized frame index calculation for uniform playback
    let frameIndex = animationFrames.length - 1; // Default to last frame
    
    // Calculate frame index based on normalized time position
    // This ensures uniform playback even when original timestamps are uneven
    if (normalizedFrameDuration > 0 && animationFrames.length > 1) {
      const normalizedTimePosition = currentTime - firstTimestamp;
      const calculatedIndex = normalizedTimePosition / normalizedFrameDuration;
      // Use Math.round to increment at midpoint between frames
      // This ensures the last frame is reached during playback
      frameIndex = Math.min(
        Math.max(0, Math.round(calculatedIndex)),
        animationFrames.length - 1
      );
    } else if (animationFrames.length === 1) {
      frameIndex = 0;
    }
    
    // Update current frame index for display (update every frame change)
    // Also store it globally so stop handler can access it
    // Always keep the global ref updated
    (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = frameIndex;
    
    // Skip frame update if we just preserved the frame position (to prevent flicker)
    const skipUpdate = (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate;
    if (skipUpdate) {
      delete (window as WindowWithViewerHandlers).__viewer3dSkipFrameUpdate;
      // Frame was already updated when preserving position
    } else if (currentFrameIndexRef.current !== frameIndex) {
      currentFrameIndexRef.current = frameIndex;
      // Use requestAnimationFrame to update state outside useFrame
      requestAnimationFrame(() => {
        if (onFrameChange) {
          onFrameChange(frameIndex);
        }
      });
    }

    // Only apply animation values if we should (playing or manual frame set)
    // But skip if user has manually changed joints (to allow manual control)
    if (!shouldApplyAnimation || (hasManualJointChangesRef.current && !isPlaying)) {
      return;
    }

    const currentFrame = animationFrames[frameIndex];
    const nextFrame =
      animationFrames[Math.min(frameIndex + 1, animationFrames.length - 1)];

    // Interpolate between frames using normalized timing
    // This ensures smooth interpolation even with uneven original timestamps
    // When paused, don't interpolate - use exact frame values
    const isPaused = !isPlaying && (window as WindowWithViewerHandlers).__viewer3dIsPaused;
    let t = 0;
    if (!isPaused && normalizedFrameDuration > 0 && frameIndex < animationFrames.length - 1) {
      // Calculate interpolation factor based on normalized time position within the frame interval
      const normalizedCurrentFrameTime = firstTimestamp + frameIndex * normalizedFrameDuration;
      const normalizedNextFrameTime = firstTimestamp + (frameIndex + 1) * normalizedFrameDuration;
      t = (currentTime - normalizedCurrentFrameTime) / normalizedFrameDuration;
      t = Math.max(0, Math.min(1, t)); // Clamp between 0 and 1
    }

    const interpolatedJoints: Record<string, number> = {};
    for (const jointName in currentFrame.joints) {
      const current = currentFrame.joints[jointName];
      const next = nextFrame.joints[jointName] ?? current;
      interpolatedJoints[jointName] = THREE.MathUtils.lerp(current, next, t);
    }

    // Check for manual joint changes flag from window (set by slider changes or dragging)
    if ((window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges) {
      hasManualJointChangesRef.current = true;
      // Clear the window property after reading it
      delete (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges;
    }
    
    // When paused and manual changes have been made, don't apply animation values
    // This allows manual control to work after stopping playback
    if (isPaused && hasManualJointChangesRef.current) {
      return;
    }

    const shouldSyncJoints = hasJointMapChanged(interpolatedJoints, storeJointValues);
    if (shouldSyncJoints) {
      // Apply joint values to robot
      applyJointValues(robotRef.current, interpolatedJoints, { filter: false });

      // Update the store in batch so UI reflects the animation
      setStoreJointValues(interpolatedJoints);

      // Also call onJointChange for each joint to notify parent
      if (onJointChange) {
        for (const [jointName, value] of Object.entries(interpolatedJoints)) {
          onJointChange(jointName, value);
        }
      }
    }
  });

  // Note: We intentionally don't reset animationStartTime when stopping playback
  // This allows us to resume from where we left off
  // The animation loop will handle preserving the current position

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
      hasManualJointChangesRef.current = true;
      
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
  }, [isDragging, onJointChange, onDragActiveChange, previewJointValue, setStoreJointValue]);

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
  const [position, setPosition] = useState<THREE.Vector3>(new THREE.Vector3());
  const [rotation, setRotation] = useState<THREE.Euler>(new THREE.Euler());
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
    const worldPos = new THREE.Vector3();
    joint.getWorldPosition(worldPos);
    setPosition(worldPos);

    // Calculate rotation to align plane perpendicular to axis
    // The plane should be perpendicular to the joint axis (plane normal = axis direction)
    // Default plane normal is (0, 0, 1) for a plane in XY plane
    // We want the plane's normal to align with the axis
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion();
    
    // If axis is parallel to default normal, use a different reference
    if (Math.abs(axisVec.dot(defaultNormal)) > 0.99) {
      // Axis is nearly parallel to Z, rotate around X axis
      quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    } else if (Math.abs(axisVec.dot(defaultNormal)) < -0.99) {
      // Axis is nearly opposite to Z, rotate around X axis the other way
      quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    } else {
      // Rotate plane so its normal aligns with the axis
      quaternion.setFromUnitVectors(defaultNormal, axisVec);
    }
    
    const euler = new THREE.Euler().setFromQuaternion(quaternion);
    setRotation(euler);
  });

  // Plane size - make it reasonably sized
  const planeSize = 0.5;

  return (
    <mesh
      ref={planeRef}
      position={position}
      rotation={rotation}
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
  const [motionDataFile, setMotionDataFile] = useState<File | null>(null);
  const [animationFrames, setAnimationFrames] = useState<
    AnimationFrame[] | null
  >(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const [urdfContent, setUrdfContent] = useState<string | null>(null);
  const [isFkDialogOpen, setIsFkDialogOpen] = useState(false);
  const [meshFiles, setMeshFiles] = useState<MeshFiles>(initialMeshFiles);
  const [isDraggingJoint, setIsDraggingJoint] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0); // 1.0 = normal speed
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const isShiftPressedRef = useRef<boolean>(false);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const fkAutoOpenedRef = useRef(false);
  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const setAvailableJointsStore = useJointStore((s) => s.setAvailableJoints);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const [endEffectorPose, setEndEffectorPose] = useState<EndEffectorPoseState>({
    pyroki: null,
    three: null,
    positionError: null,
    rotationErrorDeg: null,
    error: null,
    lastUpdated: null,
    loading: false,
  });
  const endEffectorPoseRequestId = useRef(0);
  const endEffectorPoseAbortRef = useRef<AbortController | null>(null);
  const initialPoseRef = useRef<Record<string, number>>({});

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
  });

  // Use selectedLink from props
  const selectedLink = selectedLinkProp;
  const ikObjects = useObjectStore((state) => state.objects);

  // Read URDF content once per uploaded file (for PyRoki FK validation)
  useEffect(() => {
    if (!urdfFile) {
      setUrdfContent(null);
      onLinkSelect?.(null);
      fkAutoOpenedRef.current = false;
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setUrdfContent(text);
    };
    reader.readAsText(urdfFile);
    fkAutoOpenedRef.current = false;
  }, [urdfFile, onLinkSelect]);

  // Auto-open FK validation dialog once when a new robot + URDF are ready
  useEffect(() => {
    if (!robot || !urdfContent || fkAutoOpenedRef.current) return;
    fkAutoOpenedRef.current = true;
    setIsFkDialogOpen(true);
  }, [robot, urdfContent]);
  
  // Reset current frame when animation stops or frames change
  useEffect(() => {
    if (!isPlaying || !animationFrames) {
      setCurrentFrame(0);
    }
  }, [isPlaying, animationFrames]);

  // Initialize mouse button configuration when controls are ready
  useEffect(() => {
    // Use a small delay to ensure controls are fully initialized
    const timeoutId = setTimeout(() => {
      if (!controlsRef.current) return;
      
      const controls = controlsRef.current;
      // @react-three/drei OrbitControls exposes the underlying Three.js controls
      // The ref should point to the actual OrbitControls instance
      const threeControls = controls as OrbitControlsImpl | null;
      
      // Set default mouse button configuration (Blender-style)
      // LEFT: rotate, MIDDLE: zoom (default), RIGHT: pan
      if (threeControls && threeControls.mouseButtons) {
        const mouseButtons = threeControls.mouseButtons as MouseButtonsWithOriginal;
        // Default: MMB zooms (DOLLY) if not already set
        if (mouseButtons._originalMiddle === undefined) {
          mouseButtons._originalMiddle = mouseButtons.MIDDLE ?? THREE.MOUSE.DOLLY;
          mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
        }
      }
    }, 100); // Small delay to ensure controls are initialized

    return () => clearTimeout(timeoutId);
  }, [robot]); // Re-run when robot loads

  // Handle Shift + MMB panning (Blender-style)
  useEffect(() => {
    const updateMMBBehavior = (shouldPan: boolean) => {
      if (!controlsRef.current) return;
      
      const threeControls = controlsRef.current;
      if (threeControls && threeControls.mouseButtons) {
        const mouseButtons = threeControls.mouseButtons as MouseButtonsWithOriginal;
        // Store original MMB behavior if not already stored
        if (mouseButtons._originalMiddle === undefined) {
          mouseButtons._originalMiddle = mouseButtons.MIDDLE ?? THREE.MOUSE.DOLLY;
        }
        
        // Set MMB behavior based on Shift state
        if (shouldPan) {
          mouseButtons.MIDDLE = THREE.MOUSE.PAN;
        } else {
          const originalMiddle = mouseButtons._originalMiddle ?? THREE.MOUSE.DOLLY;
          mouseButtons.MIDDLE = originalMiddle;
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Shift key press
      if (e.key === 'Shift' || e.shiftKey) {
        if (!isShiftPressedRef.current) {
          isShiftPressedRef.current = true;
          updateMMBBehavior(true);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Check if Shift was released
      if (e.key === 'Shift') {
        // Use a small delay to check if shift is actually released
        // (in case user pressed both shift keys)
        setTimeout(() => {
          // Check if shift is actually released by testing a synthetic event
          // If shiftKey is false in the event, shift was released
          if (!e.shiftKey && isShiftPressedRef.current) {
            isShiftPressedRef.current = false;
            updateMMBBehavior(false);
          }
        }, 0);
      }
    };

    // Also handle mouse events to check shift state when MMB is pressed/released
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1) { // Middle mouse button (button 1)
        if (e.shiftKey && !isShiftPressedRef.current) {
          isShiftPressedRef.current = true;
          updateMMBBehavior(true);
        } else if (!e.shiftKey && isShiftPressedRef.current) {
          isShiftPressedRef.current = false;
          updateMMBBehavior(false);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 1) { // Middle mouse button released
        // Check if shift is still pressed
        if (!e.shiftKey && isShiftPressedRef.current) {
          isShiftPressedRef.current = false;
          updateMMBBehavior(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Keep EE pose aligned between Three.js and PyRoki (base_link/world frame)
  useEffect(() => {
    if (!robot || !urdfContent || !endEffectorLink) {
      setEndEffectorPose({
        pyroki: null,
        three: null,
        positionError: null,
        rotationErrorDeg: null,
        error: null,
        lastUpdated: null,
        loading: false,
      });
      return;
    }

    const timeoutId = setTimeout(async () => {
      const requestId = ++endEffectorPoseRequestId.current;
      endEffectorPoseAbortRef.current?.abort();
      const controller = new AbortController();
      endEffectorPoseAbortRef.current = controller;

      const baseThreePose = extractLinkPose(robot, endEffectorLink);
      if (!baseThreePose) {
        setEndEffectorPose({
          pyroki: null,
          three: null,
          positionError: null,
          rotationErrorDeg: null,
          error: "End-effector link not found in scene",
          lastUpdated: null,
          loading: false,
        });
        return;
      }

      setEndEffectorPose((prev) => ({
        ...prev,
        three: baseThreePose,
        loading: true,
        error: null,
      }));

      try {
        const response = await fetch(`${API_BASE_URL}/pyroki/fk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urdf: urdfContent,
            joint_values: getLiveRobotJoints(robot, storeJointValues),
          }),
          signal: controller.signal,
        });

        const payload = (await response
          .json()
          .catch(() => ({ error: "Failed to parse PyRoki FK response" }))) as {
          error?: unknown;
          detail?: unknown;
          links?: unknown;
        };

        if (!response.ok) {
          const message =
            (typeof payload.error === "string" && payload.error) ||
            (typeof payload.detail === "string" && payload.detail) ||
            "PyRoki FK request failed";
          throw new Error(message);
        }

        if (controller.signal.aborted || requestId !== endEffectorPoseRequestId.current) {
          return;
        }

        const links = Array.isArray(payload.links) ? payload.links : [];
        const pyrokiLink = links.find((link) => {
          const name = (link as { name?: unknown }).name;
          return typeof name === "string" && name === endEffectorLink;
        }) as { position?: unknown; quaternion_wxyz?: unknown } | undefined;

        const pyrokiPose: LinkPose | null =
          pyrokiLink &&
          Array.isArray(pyrokiLink.position) &&
          pyrokiLink.position.length >= 3 &&
          Array.isArray(pyrokiLink.quaternion_wxyz) &&
          pyrokiLink.quaternion_wxyz.length >= 4
            ? {
                position: [
                  Number(pyrokiLink.position[0]) || 0,
                  Number(pyrokiLink.position[1]) || 0,
                  Number(pyrokiLink.position[2]) || 0,
                ],
                quaternion: [
                  Number(pyrokiLink.quaternion_wxyz[0]) || 0,
                  Number(pyrokiLink.quaternion_wxyz[1]) || 0,
                  Number(pyrokiLink.quaternion_wxyz[2]) || 0,
                  Number(pyrokiLink.quaternion_wxyz[3]) || 0,
                ],
              }
            : null;

        // Re-sample Three.js pose at the same moment we receive PyRoki data
        const syncedThreePose = extractLinkPose(robot, endEffectorLink) ?? baseThreePose;

        const posError = pyrokiPose ? positionDistance(pyrokiPose.position, syncedThreePose.position) : null;
        const rotError = pyrokiPose
          ? quaternionAngularErrorDeg(pyrokiPose.quaternion, syncedThreePose.quaternion)
          : null;

        setEndEffectorPose({
          pyroki: pyrokiPose,
          three: syncedThreePose,
          positionError: toZeroIfTiny(posError !== null && Number.isFinite(posError) ? posError : null, 1e-6),
          rotationErrorDeg: toZeroIfTiny(
            rotError !== null && Number.isFinite(rotError) ? rotError : null,
            1e-4
          ),
          error: pyrokiPose ? null : "End-effector missing in PyRoki FK output",
          lastUpdated: Date.now(),
          loading: false,
        });
      } catch (err) {
        if (controller.signal.aborted || requestId !== endEffectorPoseRequestId.current) return;
        setEndEffectorPose({
          pyroki: null,
          three: baseThreePose,
          positionError: null,
          rotationErrorDeg: null,
          error: err instanceof Error ? err.message : "Failed to fetch PyRoki FK",
          lastUpdated: null,
          loading: false,
        });
      }
    }, 150);

    return () => {
      clearTimeout(timeoutId);
      endEffectorPoseAbortRef.current?.abort();
    };
  }, [robot, urdfContent, endEffectorLink, storeJointValues]);
  
  // Track current frame for display
  const currentFrameIndexRef = useRef<number>(0);

  // Update mesh files when initialMeshFiles changes
  useEffect(() => {
    if (Object.keys(initialMeshFiles).length > 0) {
      setMeshFiles(initialMeshFiles);
    }
  }, [initialMeshFiles]);


  // Position camera to center on robot when it first loads
  useEffect(() => {
    if (!robot || !controlsRef.current) return;
    
    const controls = controlsRef.current;
    const camera = controls.object as THREE.PerspectiveCamera;
    const robotAny = robot;
    
    // Get robot's bounding box center (stored when robot was loaded)
    const robotCenter = robotAny.userData?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);
    
    // Calculate camera position relative to robot center
    // Position between X and Y axes, slightly elevated
    const cameraOffset = new THREE.Vector3(1.5, 1.5, 0.8);
    camera.position.copy(robotCenter).add(cameraOffset);
    
    // Set controls target to robot center (not origin)
    controls.target.copy(robotCenter);
    controls.update();
  }, [robot]);

  // Notify host about available joints and their current angles when robot is ready
  useEffect(() => {
    if (!robot) return;
    const allJoints = Object.keys(robot.joints ?? {});
    // Include all joints (including fixed) but exclude non-joint items like "imu_site_frame"
    // Fixed joints need to be visible so users can change their type back
    const joints = allJoints.filter((j) => {
      const jointObj = robot.joints?.[j];
      // Include all joint types (including fixed), but exclude sensor frames
      return jointObj &&
             (typeof resolveJointScalarValue(jointObj) === "number" || jointObj.jointType === "fixed") &&
             !j.toLowerCase().includes('imu') &&
             !j.toLowerCase().includes('site') &&
             !j.toLowerCase().includes('frame');
    });
    const angles: Record<string, number> = {};
    joints.forEach((j) => {
      const jointObj = robot.joints?.[j];
      // Fixed joints always have angle 0, other joints use their actual angle
      if (jointObj.jointType === "fixed") {
        angles[j] = 0;
      } else {
        const value = resolveJointScalarValue(jointObj);
        angles[j] = typeof value === "number" ? value : 0;
      }
    });
    initialPoseRef.current = { ...angles };
    // Update external callback
    onRobotJointsLoaded?.(joints, angles);
    // Update global store
    setAvailableJointsStore(joints);
    setStoreJointValues(angles);
  }, [
    robot,
    onRobotJointsLoaded,
    setAvailableJointsStore,
    setStoreJointValues,
  ]);

  // Calculate and send robot bounding box when robot loads
  useEffect(() => {
    if (!robot) {
      onRobotBoundingBoxChange?.(null);
      onRobotLoaded?.(null);
      return;
    }

    const box = new THREE.Box3().setFromObject(robot);
    onRobotBoundingBoxChange?.(box);
    onRobotLoaded?.(robot);
  }, [robot, onRobotBoundingBoxChange, onRobotLoaded]);

  // Apply joint values from props (skip if dragging)
  useEffect(() => {
    if (!robot || isDraggingJoint || isIkHandleDragging) return;
    applyJointValues(robot, jointValues);
  }, [robot, jointValues, isDraggingJoint, isIkHandleDragging]);

  const resetPose = useCallback(() => {
    if (!robot) return;
    const resetValues = { ...initialPoseRef.current };
    if (Object.keys(resetValues).length === 0) return;
    applyJointValues(robot, resetValues, { filter: false });
    setStoreJointValues(resetValues);
    if (onJointChange) {
      for (const [name, value] of Object.entries(resetValues)) {
        onJointChange(name, value);
      }
    }
  }, [robot, onJointChange, setStoreJointValues]);

  // Apply joint values from global store (authoritative for live slider moves, skip if dragging)
  useEffect(() => {
    if (!robot || isDraggingJoint || isIkHandleDragging) return;
    const r = robot;
    if (typeof r.setJointValues !== "function" && typeof r.setJointValue !== "function") return;
    let hasChanges = false;
    const nextValues: Record<string, number> = {};
    for (const [jointName, value] of Object.entries(storeJointValues)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        nextValues[jointName] = value;
        // Check if the value differs from current robot joint value
        const currentValue = resolveJointScalarValue(r.joints?.[jointName]);
        if (typeof currentValue === "number" && Math.abs(currentValue - value) > 0.001) {
          hasChanges = true;
        }
      }
    }
    applyJointValues(r, nextValues, { filter: false });
    // Mark manual changes if we're not playing and values actually changed
    // This allows slider changes to also prevent animation from overwriting manual changes
    if (hasChanges && !isPlaying) {
      // Use window property to communicate with URDFModel's animation loop
      (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges = true;
    }
  }, [robot, storeJointValues, isDraggingJoint, isIkHandleDragging, isPlaying]);

  const parseMotionDataFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      let sourceFrames: { timestamp: number; joints: Record<string, number> }[] | undefined;
      let jointOrder: string[] | undefined;

      const jsonResult = parseEpisodeJson(content);
      if (jsonResult.episodes && jsonResult.episodes.length > 0) {
        const episode = jsonResult.episodes[0];
        sourceFrames = episode.frames;
        jointOrder = episode.jointOrder;
        if (jsonResult.episodes.length > 1) {
          toast.info(
            `Found ${jsonResult.episodes.length} episodes in file; loading the first one`
          );
        }
      } else if (jsonResult.frames) {
        sourceFrames = jsonResult.frames;
        jointOrder = jsonResult.jointOrder;
      } else {
        const csvResult = parseEpisodeCsv(content);
        if (!csvResult.frames) {
          toast.error(jsonResult.error ?? csvResult.error ?? "Invalid motion data format");
          return;
        }
        sourceFrames = csvResult.frames;
        jointOrder = csvResult.jointOrder;
      }

      if (!sourceFrames || sourceFrames.length === 0) {
        toast.error("No data rows found");
        return;
      }

      const robotAny = robot;
      const robotJointKeys: string[] = robotAny
        ? Object.keys(robotAny.joints || {})
        : [];
      const knownJoints = new Set(robotJointKeys);
      const actuatedJoints: string[] = robotJointKeys
        .filter((key) => {
          const joint = robotAny?.joints?.[key];
          const value = resolveJointScalarValue(joint);
          return joint && joint.jointType !== "fixed" && typeof value === "number";
        })
        .sort((a, b) => {
          const aNum = Number(a);
          const bNum = Number(b);
          if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
            return aNum - bNum;
          }
          return a.localeCompare(b);
        });

      const columns =
        (jointOrder && jointOrder.length > 0
          ? jointOrder
          : Array.from(
              new Set(
                sourceFrames.flatMap((frame) => Object.keys(frame.joints))
              )
            )) ?? [];

      const mapping = new Map<string, string>();
      const actuatedSet = new Set(actuatedJoints);
      const skippedJointNames = new Set<string>();

      columns.forEach((columnName) => {
        if (knownJoints.has(columnName)) {
          mapping.set(columnName, columnName);
        }
      });

      if (
        mapping.size === 0 &&
        actuatedJoints.length > 0 &&
        columns.length === actuatedJoints.length
      ) {
        columns.forEach((columnName, index) => {
          if (index < actuatedJoints.length) {
            mapping.set(columnName, actuatedJoints[index]);
          }
        });
      }

      const frames: AnimationFrame[] = sourceFrames.map((frame) => {
        const mapped: Record<string, number> = {};
        for (const [sourceJoint, value] of Object.entries(frame.joints)) {
          const targetJoint =
            mapping.get(sourceJoint) ??
            (knownJoints.has(sourceJoint) ? sourceJoint : undefined);
          if (targetJoint !== undefined && knownJoints.has(targetJoint)) {
            mapped[targetJoint] = value;
          } else {
            skippedJointNames.add(sourceJoint);
          }
        }
        return { timestamp: frame.timestamp, joints: mapped };
      });

      if (frames.length === 0) {
        toast.error("No data rows found");
        return;
      }

      const hasJointData = frames.some((frame) => Object.keys(frame.joints).length > 0);
      if (!hasJointData) {
        toast.error("No matching joint data found for this robot");
        return;
      }

      if (skippedJointNames.size > 0) {
        const skipped = Array.from(skippedJointNames);
        const preview = skipped.slice(0, 5).join(", ");
        const more = skipped.length > 5 ? `, +${skipped.length - 5} more` : "";
        toast.warning(`Skipped ${skipped.length} unknown joint(s): ${preview}${more}`);
      }

      setIsPlaying(false);
      setAnimationFrames(frames);

      if (robot && frames.length > 0) {
        const firstFrame = frames[0].joints;
        applyJointValues(robot, firstFrame, { filter: false });
        setStoreJointValues(firstFrame);
      }

      const jointNames = Object.keys(frames[0]?.joints || {});

      toast.success(
        `Loaded ${frames.length} frames with ${jointNames.length} joints`
      );
    };

    reader.readAsText(file);
  }, [robot, setAnimationFrames, setIsPlaying, setStoreJointValues]);

  const handleMotionDataUpload = useCallback((e: React.ChangeEvent<HTMLInputElement> | File) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (file) {
      setMotionDataFile(file);
      parseMotionDataFile(file);
      onMotionFileChange?.(file);
      toast.success(`Motion data file uploaded: ${file.name}`);
    }
  }, [onMotionFileChange, parseMotionDataFile]);

  // Convert imported animation frames to nodes
  const convertMotionFramesToNodes = (frames: AnimationFrame[]) => {
    if (!frames || frames.length === 0) return { nodes: [], edges: [] };

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Create nodes for each keyframe
    frames.forEach((frame, index) => {
      const timestamp = frame.timestamp;
      const joints = Object.entries(frame.joints).map(([name, value]) => ({
        name,
        value,
      }));

      const node = {
        id: `motion-keyframe-${index}`,
        type: "customNode",
        position: {
          x: 100 + index * 200, // Spread nodes horizontally
          y: 100 + (index % 3) * 150, // Create rows of 3
        },
        data: {
          type: "joint",
          joints,
          onJointChange,
          onDelete: () => {
            // Handle node deletion if needed
          },
          isImportedNode: true,
          timestamp: timestamp,
          frameIndex: index,
        },
        hidden: true, // Hide imported nodes visually but keep them for animation
      };

      nodes.push(node);

      // Create edges between consecutive frames
      if (index > 0) {
        const edge = {
          id: `motion-edge-${index - 1}-${index}`,
          source: `motion-keyframe-${index - 1}`,
          target: `motion-keyframe-${index}`,
          type: "custom",
          data: {
            onDelete: () => {
              // Handle edge deletion if needed
            },
          },
          hidden: true, // Hide imported edges visually but keep them for animation
        };
        edges.push(edge);
      }
    });

    return { nodes, edges };
  };

  const handleRun = useCallback((forceState?: boolean) => {
    if (!animationFrames || animationFrames.length === 0) {
      toast.error("Please upload a motion data file first");
      return;
    }
    if (!robot) {
      toast.error("Please upload a URDF file first");
      return;
    }
    // If forceState is provided, use it; otherwise toggle
    const newPlayingState = forceState !== undefined ? forceState : !isPlaying;
    
    // If we're starting to play and we're at the last frame, reset to frame 0 first
    if (newPlayingState && !isPlaying) {
      const currentFrameIdx = (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex;
      const lastFrameIdx = animationFrames.length - 1;
      
      if (currentFrameIdx !== undefined && currentFrameIdx !== null && currentFrameIdx >= lastFrameIdx) {
        // We're at the last frame - reset to frame 0 before starting to play
        const firstTimestamp = animationFrames[0].timestamp;
        const lastTimestamp = animationFrames[lastFrameIdx].timestamp;
        const animationDuration = lastTimestamp - firstTimestamp;
        const normalizedFrameDuration = animationDuration / Math.max(1, animationFrames.length - 1);
        
        // Use window properties to communicate with the animation loop
        // Set manual frame time to first frame
        const normalizedFirstTime = firstTimestamp;
        (window as WindowWithViewerHandlers).__viewer3dManualFrameTime = normalizedFirstTime;
        (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = 0;
        (window as WindowWithViewerHandlers).__viewer3dResetAnimationStartTime = true; // Flag to reset animation start time
        // Clear any preserved frame time that might keep us at the last frame
        delete (window as WindowWithViewerHandlers).__viewer3dPreserveFrameTime;
        
        // Update frame callback immediately
        if (onFrameChange) {
          onFrameChange(0);
        }
      }
    }
    
    setIsPlaying(newPlayingState);
    onPlayingChange?.(newPlayingState);
    // Clear pause flag when starting to play
    if (newPlayingState) {
      delete (window as WindowWithViewerHandlers).__viewer3dIsPaused;
      // Clear manual joint changes flag when starting to play - allow animation to take control
      // Use window property since URDFModel manages the actual ref
      delete (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges;
    } else {
      // Set pause flag when pausing
      (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
    }
  }, [animationFrames, robot, isPlaying, onFrameChange, onPlayingChange]);

  // Handler to play episode frames directly
  const handlePlayEpisode = useCallback((frames: AnimationFrame[]) => {
    if (!frames || frames.length === 0) {
      toast.error("No frames to play");
      return;
    }

    // Stop any currently playing animation first
    setIsPlaying(false);
    
    // Set the episode frames (this will trigger reset in URDFModel's useEffect)
    setAnimationFrames(frames);
    
    // Start playing after a brief delay to ensure frames are set
    setTimeout(() => {
      setIsPlaying(true);
      onPlayingChange?.(true);
      // Clear pause flag when starting to play
      delete (window as WindowWithViewerHandlers).__viewer3dIsPaused;
      // Clear manual joint changes flag when starting to play - allow animation to take control
      // Note: hasManualJointChangesRef is in URDFModel, so we use window property
      delete (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges;
    }, 10);
  }, [onPlayingChange]);

  // Handler to stop animation
  const handleStopAnimation = useCallback(() => {
    // Before stopping, preserve the current frame position
    // This prevents the frame from jumping to 0 when stopped
    if (animationFrames && animationFrames.length > 0) {
      const firstTimestamp = animationFrames[0].timestamp;
      const lastTimestamp = animationFrames[animationFrames.length - 1].timestamp;
      const animationDuration = lastTimestamp - firstTimestamp;
      const normalizedFrameDuration = animationDuration / Math.max(1, animationFrames.length - 1);
      
      // Get current frame index from the ref (set by animation loop)
      const currentFrameIdx = (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex ?? 0;
      
      // Calculate normalized time for current frame
      const normalizedTime = firstTimestamp + currentFrameIdx * normalizedFrameDuration;
      
      // Store it immediately so the animation loop can use it right away
      (window as WindowWithViewerHandlers).__viewer3dPreserveFrameTime = normalizedTime;
      
      // Also immediately update the frame callback to prevent UI from showing wrong frame
      if (onFrameChange && currentFrameIdx >= 0) {
        onFrameChange(currentFrameIdx);
      }
    }
    
    setIsPlaying(false);
    onPlayingChange?.(false);
    // Set pause flag to prevent interpolation when stopped
    (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
  }, [onPlayingChange, animationFrames, onFrameChange]);

  // Handler to clear animation frames and release robot for manual control
  const handleClearAnimation = useCallback(() => {
    setIsPlaying(false);
    onPlayingChange?.(false);
    setAnimationFrames(null);
    // Clear all animation-related flags
    (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
    delete (window as WindowWithViewerHandlers).__viewer3dPreserveFrameTime;
    delete (window as WindowWithViewerHandlers).__viewer3dManualFrameTime;
    delete (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex;
  }, [onPlayingChange]);

  // Handler to set a specific frame index (Blender-style frame navigation)
  const handleSetFrame = useCallback((frameIndex: number) => {
    if (!animationFrames || animationFrames.length === 0) {
      return;
    }
    
    // Stop playback when navigating frames
    setIsPlaying(false);
    onPlayingChange?.(false);
    
    // Set pause flag to prevent interpolation when frame is manually set
    (window as WindowWithViewerHandlers).__viewer3dIsPaused = true;
    
    // Clamp frame index to valid range
    const clampedIndex = Math.max(0, Math.min(frameIndex, animationFrames.length - 1));
    const targetFrame = animationFrames[clampedIndex];
    
    // Set manual frame time to jump to this frame
    if (targetFrame) {
      (window as WindowWithViewerHandlers).__viewer3dManualFrameTime = targetFrame.timestamp;
      
      // Immediately update frame index to prevent it from going to frame 1
      (window as WindowWithViewerHandlers).__viewer3dCurrentFrameIndex = clampedIndex;
      
      // Update frame change callback immediately
      if (onFrameChange) {
        onFrameChange(clampedIndex);
      }
    }
  }, [animationFrames, onPlayingChange, onFrameChange]);

  // Expose handlers for external use (e.g., from Sidebar)
  useEffect(() => {
    (window as WindowWithViewerHandlers).viewer3dPlayAnimation = handleRun;
    (window as WindowWithViewerHandlers).viewer3dUploadMotionData = handleMotionDataUpload;
    (window as WindowWithViewerHandlers).viewer3dPlayEpisode = handlePlayEpisode;
    (window as WindowWithViewerHandlers).viewer3dStopAnimation = handleStopAnimation;
    (window as WindowWithViewerHandlers).viewer3dClearAnimation = handleClearAnimation;
    (window as WindowWithViewerHandlers).viewer3dSetFrame = handleSetFrame;
    (window as WindowWithViewerHandlers).viewer3dSetPlaybackSpeed = setPlaybackSpeed;
    (window as WindowWithViewerHandlers).viewer3dGetPlaybackSpeed = () => playbackSpeed;
    return () => {
      delete (window as WindowWithViewerHandlers).viewer3dPlayAnimation;
      delete (window as WindowWithViewerHandlers).viewer3dUploadMotionData;
      delete (window as WindowWithViewerHandlers).viewer3dPlayEpisode;
      delete (window as WindowWithViewerHandlers).viewer3dStopAnimation;
      delete (window as WindowWithViewerHandlers).viewer3dClearAnimation;
      delete (window as WindowWithViewerHandlers).viewer3dSetFrame;
      delete (window as WindowWithViewerHandlers).viewer3dSetPlaybackSpeed;
      delete (window as WindowWithViewerHandlers).viewer3dGetPlaybackSpeed;
      delete (window as WindowWithViewerHandlers).__viewer3dManualFrameTime;
    };
  }, [handleRun, handleMotionDataUpload, handlePlayEpisode, handleStopAnimation, handleClearAnimation, handleSetFrame, playbackSpeed]);

  // Close drag mode menu when clicking outside
  useEffect(() => {
    if (!isDragModeMenuOpen) return;

    const handleClickOutside = () => {
      setIsDragModeMenuOpen(false);
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isDragModeMenuOpen]);

  // Log drag mode changes (for debugging - modes don't have functionality yet)
  useEffect(() => {
    console.log(`[Drag Mode] Switched to: ${getDragModeDisplayName(dragMode)}`);
  }, [dragMode]);

  // Notify when animation frames change
  useEffect(() => {
    onAnimationFramesChange?.(animationFrames !== null && animationFrames.length > 0);
  }, [animationFrames, onAnimationFramesChange]);

  // Notify when playing state changes
  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  // Notify when frame changes
  useEffect(() => {
    if (animationFrames && animationFrames.length > 0) {
      onFrameChange?.(currentFrame, animationFrames.length);
    }
  }, [currentFrame, animationFrames, onFrameChange]);

  // Navigation functions for Blender-style view buttons
  const setView = useCallback((direction: 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right') => {
    if (!controlsRef.current || !cameraRef.current || !robot || !sceneRef.current) return;
    
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const robotAny = robot;
    const scene = sceneRef.current;
    
    // Try to find robot in scene and get bounding box
    let center: THREE.Vector3;
    let distance: number;
    
    // Find robot group in scene
    let robotGroup: THREE.Object3D | null = null;
    scene.traverse((obj) => {
      if (obj === robotAny || (obj.userData && obj.userData.isURDFRobot)) {
        robotGroup = obj;
      }
    });
    
    // Use robot if found, otherwise try robotAny directly
    const targetObj = robotGroup || robotAny;
    
    // Calculate bounding box
    const box = new THREE.Box3();
    try {
      box.setFromObject(targetObj);
    } catch (e) {
      // If setFromObject fails, fall back to stored center
    }
    
    if (!box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      distance = Math.max(maxDim * 1.5, 2);
    } else {
      // Fallback to stored center
      center = robotAny.userData?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);
      distance = 3;
    }
    
    let cameraPosition: THREE.Vector3;
    
    // Set camera position based on view direction
    // ROS REP-103 / URDF Standard Coordinate System:
    // X = forward (red), Y = left (green), Z = up (blue)
    switch (direction) {
      case 'front': // Looking from behind robot (+X direction)
        cameraPosition = new THREE.Vector3(center.x + distance, center.y, center.z);
        break;
      case 'back': // Looking from front of robot (-X direction)
        cameraPosition = new THREE.Vector3(center.x - distance, center.y, center.z);
        break;
      case 'left': // Looking from robot's right side (-Y direction)
        cameraPosition = new THREE.Vector3(center.x, center.y - distance, center.z);
        break;
      case 'right': // Looking from robot's left side (+Y direction)
        cameraPosition = new THREE.Vector3(center.x, center.y + distance, center.z);
        break;
      case 'top': // Looking from +Z direction
        cameraPosition = new THREE.Vector3(center.x, center.y, center.z + distance);
        break;
      case 'bottom': // Looking from -Z direction
        cameraPosition = new THREE.Vector3(center.x, center.y, center.z - distance);
        break;
      default:
        return;
    }
    
    // Smoothly animate camera to new position
    camera.position.copy(cameraPosition);
    controls.target.copy(center);
    controls.update();
  }, [robot]);

  // Switch to camera view
  const handleCameraViewChange = useCallback((cameraId: string) => {
    if (!controlsRef.current || !cameraRef.current || !robot) return;

    const cameras = useCameraStore.getState().cameras;
    const camera = cameras.find((c) => c.id === cameraId);
    if (!camera) return;

    const controls = controlsRef.current;
    const viewCamera = cameraRef.current;
    const robotAny = robot;

    // Get parent link
    const parentLink = robotAny.links?.[camera.parent_link];
    if (!parentLink) return;

    // Update parent link transform
    parentLink.updateMatrixWorld(true);
    const parentWorldTransform = new THREE.Matrix4().copy(parentLink.matrixWorld);

    // Create local transform from camera pose
    const localTransform = new THREE.Matrix4();
    const RPY_ORDER = 'ZYX' as const;
    localTransform.makeRotationFromEuler(
      new THREE.Euler(...camera.pose.rpy, RPY_ORDER)
    );
    localTransform.setPosition(new THREE.Vector3(...camera.pose.xyz));

    // Combine: world = parentWorld * local
    const finalTransform = parentWorldTransform.clone().multiply(localTransform);

    const cameraPosition = new THREE.Vector3();
    const cameraQuaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    finalTransform.decompose(cameraPosition, cameraQuaternion, scale);

    // Camera forward direction: +X in robotics convention
    // Three.js camera looks along -Z, so rotate +90° around Y to align
    const cameraRotation = new THREE.Quaternion();
    cameraRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const finalQuaternion = cameraQuaternion.clone().multiply(cameraRotation);

    // Calculate forward direction based on the final camera orientation (-Z in Three.js)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(finalQuaternion);

    // Set camera position and look at a point in front of the camera
    const lookAtDistance = 1.0;
    const lookAtPoint = cameraPosition.clone().add(forward.multiplyScalar(lookAtDistance));

    // Set Three.js camera orientation (it looks along -Z, so we rotate it)
    viewCamera.position.copy(cameraPosition);
    viewCamera.quaternion.copy(finalQuaternion);
    controls.target.copy(lookAtPoint);
    controls.update();
  }, [robot]);

  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const cameras = useCameraStore((state) => state.cameras);
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState(false);

  useEffect(() => {
    if (!isCameraMenuOpen) return;
    const handleClick = () => setIsCameraMenuOpen(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [isCameraMenuOpen]);

  useEffect(() => {
    if (!selectedCameraId) return;
    handleCameraViewChange(selectedCameraId);
  }, [handleCameraViewChange, selectedCameraId]);

  // Fit to view function
  const fitToView = useCallback(() => {
    if (!controlsRef.current || !cameraRef.current || !robot || !sceneRef.current) return;
    
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const robotAny = robot;
    const scene = sceneRef.current;
    
    // Try to find robot in scene and get bounding box
    let center: THREE.Vector3;
    let size: THREE.Vector3;
    
    // Find robot group in scene
    let robotGroup: THREE.Object3D | null = null;
    scene.traverse((obj) => {
      if (obj === robotAny || (obj.userData && obj.userData.isURDFRobot)) {
        robotGroup = obj;
      }
    });
    
    // Use robot if found, otherwise try robotAny directly
    const targetObj = robotGroup || robotAny;
    
    // Calculate bounding box
    const box = new THREE.Box3();
    try {
      box.setFromObject(targetObj);
    } catch (e) {
      // If setFromObject fails, fall back to stored center
    }
    
    if (!box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3());
      size = box.getSize(new THREE.Vector3());
    } else {
      // Fallback: use stored center
      center = robotAny.userData?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);
      size = new THREE.Vector3(2, 2, 2); // Default size
    }
    
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // Calculate distance to fit the robot in view
    // Use FOV to calculate appropriate distance
    const fov = camera.fov * (Math.PI / 180);
    const distance = Math.max(maxDim * 1.5 / Math.tan(fov / 2), 2);
    
    // Get current camera direction
    const direction = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    
    // If direction is zero (camera at target), use default view
    if (direction.length() < 0.001) {
      direction.set(1, 1, 0.5).normalize();
    }
    
    // Position camera at appropriate distance
    const newPosition = center.clone().add(direction.multiplyScalar(distance));
    camera.position.copy(newPosition);
    controls.target.copy(center);
    controls.update();
  }, [robot]);

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
        {/* Joint Types Panel or Links Panel - Blender Style */}
        {Object.keys(jointLimits || {}).length > 0 && (() => {
          // Helper to convert hex to rgba
          const hexToRgba = (hex: string, alpha: number) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          };

          // Always show joints panel regardless of drag mode
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
              {/* Joint Types List - Compact (First) */}
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

              {/* Selected Link Section - Compact (Second) */}
              <div className="pt-1.5 border-t border-border/15">
                <div className="text-[9px] font-semibold text-muted-foreground/80 tracking-tight mb-0.5 uppercase">
                  Selected Link
                </div>
                <div className="text-[11px] text-foreground font-medium truncate">
                  {selectedLink || "None"}
                </div>
              </div>

              {/* Associated Joint Section - Compact (Third) */}
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
                const radius = targetObj.orbitRadius ?? 0.3;
                const inclination = targetObj.orbitInclination ?? 45;
                const basePhase = targetObj.orbitPhase ?? 0;

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
            (window as WindowWithViewerHandlers).__viewer3dCamera = camera;
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

        {robot && urdfContent && (
          <FKValidationDialog
            open={isFkDialogOpen}
            onOpenChange={setIsFkDialogOpen}
            urdfContent={urdfContent}
            robot={robot}
          />
        )}

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
