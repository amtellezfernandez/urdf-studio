import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { BlenderPanel, BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { NumberInput } from "@/shared/ui/number-input";
import { useObjectStore } from "@/features/objects";
import { useIkDebugStore } from "@/features/ik/useIkDebugStore";
import type { IkSolverId, IkSolverMeta } from "@/features/ik/types";
import { useIkSolverStore } from "@/features/ik/useIkSolverStore";
import { useIkParamsStore } from "@/features/ik/useIkParamsStore";
import { FEATURE_GATES, withUnavailableSuffix } from "@/shared/config/featureGates";

interface IkDebuggerPanelProps {
  urdfContent?: string | null;
  robot?: URDFRobot | null;
  endEffectorLink?: string | null;
  robotBoundingBox?: THREE.Box3 | null;
}

const formatVec3 = (vec: [number, number, number]) =>
  `x:${vec[0].toFixed(3)} y:${vec[1].toFixed(3)} z:${vec[2].toFixed(3)}`;

const formatQuat = (quat: [number, number, number, number]) =>
  `w:${quat[0].toFixed(3)} x:${quat[1].toFixed(3)} y:${quat[2].toFixed(3)} z:${quat[3].toFixed(3)}`;

const formatMaybe = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined ? "-" : value.toFixed(digits);

export const IkDebuggerPanel = ({
  urdfContent,
  robot,
  endEffectorLink,
  robotBoundingBox,
}: IkDebuggerPanelProps) => {
  const ikRemoteGate = FEATURE_GATES.ikRemoteSolve;
  const debugRef = useRef(useIkDebugStore.getState());
  const objectsRef = useRef(useObjectStore.getState().objects);
  const [debugSnapshot, setDebugSnapshot] = useState(debugRef.current);
  const [objectsSnapshot, setObjectsSnapshot] = useState(objectsRef.current);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const selectedSolverId = useIkSolverStore((s) => s.selectedSolverId);
  const availableSolvers = useIkSolverStore((s) => s.availableSolvers);
  const setSelectedSolverId = useIkSolverStore((s) => s.setSelectedSolverId);
  const clickOrientation = useIkParamsStore((s) => s.clickOrientation);
  const dragOrientation = useIkParamsStore((s) => s.dragOrientation);
  const requestTimeoutMs = useIkParamsStore((s) => s.requestTimeoutMs);
  const dragTimeoutMs = useIkParamsStore((s) => s.dragTimeoutMs);
  const orbitTimeoutMs = useIkParamsStore((s) => s.orbitTimeoutMs);
  const orbitDefaults = useIkParamsStore((s) => s.orbitDefaults);
  const setClickOrientation = useIkParamsStore((s) => s.setClickOrientation);
  const setDragOrientation = useIkParamsStore((s) => s.setDragOrientation);
  const setRequestTimeoutMs = useIkParamsStore((s) => s.setRequestTimeoutMs);
  const setDragTimeoutMs = useIkParamsStore((s) => s.setDragTimeoutMs);
  const setOrbitTimeoutMs = useIkParamsStore((s) => s.setOrbitTimeoutMs);

  useEffect(() => {
    const unsubscribeDebug = useIkDebugStore.subscribe((state) => {
      debugRef.current = state;
    });
    const unsubscribeObjects = useObjectStore.subscribe((state) => {
      objectsRef.current = state.objects;
    });
    return () => {
      unsubscribeDebug();
      unsubscribeObjects();
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setDebugSnapshot(debugRef.current);
      setObjectsSnapshot(objectsRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ikTargets = useMemo(
    () => objectsSnapshot.filter((obj) => obj.isIkTarget),
    [objectsSnapshot]
  );

  useEffect(() => {
    const targetIds = ikTargets.map((obj) => obj.id);
    if (debugSnapshot.targetName && targetIds.includes(debugSnapshot.targetName)) {
      setSelectedTargetId(debugSnapshot.targetName);
      return;
    }
    if (selectedTargetId && targetIds.includes(selectedTargetId)) {
      return;
    }
    setSelectedTargetId(targetIds[0] ?? null);
  }, [debugSnapshot.targetName, ikTargets, selectedTargetId]);

  const selectedTarget = useMemo(() => {
    if (!selectedTargetId) return null;
    return ikTargets.find((obj) => obj.id === selectedTargetId) ?? null;
  }, [ikTargets, selectedTargetId]);

  const targetPosition = useMemo(() => {
    if (!selectedTarget) return null;

    if (selectedTarget.ikTargetType !== "orbit" || selectedTarget.orbitTargetPoint === "center") {
      return [selectedTarget.position.x, selectedTarget.position.y, selectedTarget.position.z] as [
        number,
        number,
        number,
      ];
    }

    const radius = selectedTarget.orbitRadius ?? orbitDefaults.radius;
    const inclination = selectedTarget.orbitInclination ?? orbitDefaults.inclinationDeg;
    const basePhase = selectedTarget.orbitPhase ?? orbitDefaults.phaseDeg;
    const secondaryOffset =
      selectedTarget.orbitTargetPoint === "secondary"
        ? selectedTarget.orbitSecondaryOffset ?? orbitDefaults.secondaryOffsetDeg
        : 0;

    const phase = basePhase + secondaryOffset;
    const phaseRad = (phase * Math.PI) / 180;
    const inclinationRad = (inclination * Math.PI) / 180;

    const x = Math.cos(phaseRad) * radius;
    const y = Math.sin(phaseRad) * radius;
    const z = y * Math.sin(inclinationRad);
    const yAdjusted = y * Math.cos(inclinationRad);

    return [
      selectedTarget.position.x + x,
      selectedTarget.position.y + yAdjusted,
      selectedTarget.position.z + z,
    ] as [number, number, number];
  }, [orbitDefaults, selectedTarget]);

  const solverOptions = useMemo(() => {
    const byId = new Map<IkSolverId, IkSolverMeta>();
    availableSolvers.forEach((solver) => {
      byId.set(solver.id, solver);
    });
    if (!byId.has(selectedSolverId)) {
      byId.set(selectedSolverId, {
        id: selectedSolverId,
        label: selectedSolverId,
        source: "local",
      });
    }
    const ordered = Array.from(byId.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    const availableIds = new Set(availableSolvers.map((solver) => solver.id));
    return ordered.map((solver) => ({
      id: solver.id,
      label: solver.label ?? solver.id,
      unavailable: !availableIds.has(solver.id),
    }));
  }, [availableSolvers, selectedSolverId]);

  const orientationOptions = useMemo(
    () => [
      { id: "auto", label: "Auto" },
      { id: "prefer", label: "Prefer" },
      { id: "optional", label: "Optional" },
      { id: "ignore", label: "Ignore" },
      { id: "required", label: "Required" },
    ],
    []
  );


  const bboxSummary = useMemo(() => {
    if (!robotBoundingBox || robotBoundingBox.isEmpty()) return null;
    const size = new THREE.Vector3();
    robotBoundingBox.getSize(size);
    return {
      min: [robotBoundingBox.min.x, robotBoundingBox.min.y, robotBoundingBox.min.z] as [
        number,
        number,
        number,
      ],
      max: [robotBoundingBox.max.x, robotBoundingBox.max.y, robotBoundingBox.max.z] as [
        number,
        number,
        number,
      ],
      size: [size.x, size.y, size.z] as [number, number, number],
    };
  }, [robotBoundingBox]);

  const orbitMode = selectedTarget?.ikTargetType === "orbit";
  const isDragHandle = debugSnapshot.targetName === "drag-handle";
  const displayTargetPosition = isDragHandle
    ? debugSnapshot.lastTargetPosition
    : targetPosition ?? debugSnapshot.lastTargetPosition;
  const displayTargetQuaternion = debugSnapshot.lastTargetQuaternion;

  return (
    <div className="space-y-2">
      <BlenderPanel title="IK" defaultOpen={true}>
        <div className="space-y-0.5">
          <BlenderPropertyRow label="Status">
            <span className="text-[10px] text-foreground">
              {debugSnapshot.status}
              {debugSnapshot.status === "error" && debugSnapshot.error
                ? `: ${debugSnapshot.error}`
                : ""}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Solver">
            <div className="flex items-center gap-2">
              <select
                value={selectedSolverId}
                onChange={(event) => setSelectedSolverId(event.target.value as typeof selectedSolverId)}
                className="h-5 rounded border border-border/60 bg-background px-2 text-[10px] text-foreground"
              >
                {solverOptions.map((option) => (
                  <option key={option.id} value={option.id} disabled={option.unavailable}>
                    {option.label}
                    {option.unavailable ? " (unavailable)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {!ikRemoteGate.enabled ? (
              <div className="mt-1 text-[9px] text-muted-foreground">
                {withUnavailableSuffix("Online IK solvers", ikRemoteGate)}
              </div>
            ) : null}
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Target">
            <span className="text-[10px] text-foreground">
              {selectedTarget ? selectedTarget.id : "None"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Link">
            <span className="text-[10px] text-foreground">
              {endEffectorLink ?? "None"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Target Pos">
            <span className="text-[10px] font-mono text-foreground">
              {displayTargetPosition ? formatVec3(displayTargetPosition) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Target Rot">
            <span className="text-[10px] font-mono text-foreground">
              {displayTargetQuaternion ? formatQuat(displayTargetQuaternion) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Mode">
            <span className="text-[10px] text-foreground">
              {selectedTarget?.ikTargetType ?? "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Point">
            <span className="text-[10px] text-foreground">
              {orbitMode ? selectedTarget?.orbitTargetPoint ?? "-" : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Solve ms">
            <span className="text-[10px] font-mono text-foreground">
              {debugSnapshot.durationMs !== null
                ? debugSnapshot.durationMs.toFixed(0)
                : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Rover">
            <span className="text-[10px] text-foreground">
              {debugSnapshot.roverApproachStatus}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Rover Phase">
            <span className="text-[10px] text-foreground">
              {debugSnapshot.roverApproachPhase}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Rover Why">
            <span className="text-[10px] text-foreground">
              {debugSnapshot.roverApproachReason ?? "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Rover Dist">
            <span className="text-[10px] font-mono text-foreground">
              {formatMaybe(debugSnapshot.roverApproachDistanceM, 3)}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Rover Yaw">
            <span className="text-[10px] font-mono text-foreground">
              {formatMaybe(debugSnapshot.roverApproachYawErrorDeg, 2)}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Rover ms">
            <span className="text-[10px] font-mono text-foreground">
              {formatMaybe(debugSnapshot.roverApproachDurationMs, 0)}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Radius">
            <span className="text-[10px] font-mono text-foreground">
              {orbitMode ? formatMaybe(selectedTarget?.orbitRadius, 3) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Incline">
            <span className="text-[10px] font-mono text-foreground">
              {orbitMode ? formatMaybe(selectedTarget?.orbitInclination, 1) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Phase">
            <span className="text-[10px] font-mono text-foreground">
              {orbitMode ? formatMaybe(selectedTarget?.orbitPhase, 1) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Offset">
            <span className="text-[10px] font-mono text-foreground">
              {orbitMode ? formatMaybe(selectedTarget?.orbitSecondaryOffset, 1) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Orbit">
            <span className="text-[10px] font-mono text-foreground">
              {debugSnapshot.isFollowingOrbit
                ? `${debugSnapshot.orbitFollowProgress.toFixed(0)}%`
                : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Iter">
            <span className="text-[10px] font-mono text-foreground">
              {debugSnapshot.diagnostics ? debugSnapshot.diagnostics.iterations : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Cost">
            <span className="text-[10px] font-mono text-foreground">
              {debugSnapshot.diagnostics
                ? debugSnapshot.diagnostics.cost.toFixed(4)
                : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Term">
            <span className="text-[10px] text-foreground">
              {debugSnapshot.diagnostics
                ? debugSnapshot.diagnostics.termination_reason
                : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Valid">
            <span className="text-[10px] text-foreground">
              {debugSnapshot.diagnostics ? debugSnapshot.diagnostics.validity : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Degeneracy">
            <span className="text-[10px] text-foreground">
              {debugSnapshot.diagnostics ? debugSnapshot.diagnostics.degeneracy : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Branch">
            <span className="text-[10px] text-foreground">
              {debugSnapshot.diagnostics
                ? debugSnapshot.diagnostics.branch_maybe
                  ? "possible"
                  : "expected"
                : "-"}
            </span>
          </BlenderPropertyRow>
        </div>
      </BlenderPanel>

      <BlenderPanel title="Parameters" defaultOpen={false}>
        <div className="space-y-0.5">
          <BlenderPropertyRow label="Click orient">
            <select
              value={clickOrientation}
              onChange={(event) => setClickOrientation(event.target.value as typeof clickOrientation)}
              className="h-5 rounded border border-border/60 bg-background px-2 text-[10px] text-foreground"
            >
              {orientationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Drag orient">
            <select
              value={dragOrientation}
              onChange={(event) => setDragOrientation(event.target.value as typeof dragOrientation)}
              className="h-5 rounded border border-border/60 bg-background px-2 text-[10px] text-foreground"
            >
              {orientationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Solve ms">
            <div className="w-24">
              <NumberInput
                compact
                min={50}
                max={10000}
                step={50}
                value={requestTimeoutMs}
                onValueChange={setRequestTimeoutMs}
              />
            </div>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Drag ms">
            <div className="w-24">
              <NumberInput
                compact
                min={50}
                max={10000}
                step={50}
                value={dragTimeoutMs}
                onValueChange={setDragTimeoutMs}
              />
            </div>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Orbit ms">
            <div className="w-24">
              <NumberInput
                compact
                min={50}
                max={10000}
                step={50}
                value={orbitTimeoutMs}
                onValueChange={setOrbitTimeoutMs}
              />
            </div>
          </BlenderPropertyRow>
        </div>
      </BlenderPanel>
      <BlenderPanel title="BBox" defaultOpen={true}>
        <div className="space-y-0.5">
          <BlenderPropertyRow label="Min">
            <span className="text-[10px] font-mono text-foreground">
              {bboxSummary ? formatVec3(bboxSummary.min) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Max">
            <span className="text-[10px] font-mono text-foreground">
              {bboxSummary ? formatVec3(bboxSummary.max) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Size">
            <span className="text-[10px] font-mono text-foreground">
              {bboxSummary ? formatVec3(bboxSummary.size) : "-"}
            </span>
          </BlenderPropertyRow>
        </div>
      </BlenderPanel>
    </div>
  );
};
