import { useMemo } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { BlenderPanel, BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { useObjectStore } from "@/features/objects";
import { useIkDebugStore } from "@/features/ik/useIkDebugStore";
import { FkComparisonPanel } from "@/features/ik/FkComparisonPanel";
import { IK_ORBIT_DEFAULTS } from "@/features/viewer/config";
import { DEFAULT_IK_SOLVER_CHAIN } from "@/features/ik/registry";

interface IkDebuggerPanelProps {
  urdfContent?: string | null;
  robot?: URDFRobot | null;
  endEffectorLink?: string | null;
  robotBoundingBox?: THREE.Box3 | null;
}

const formatVec3 = (vec: [number, number, number]) =>
  `x:${vec[0].toFixed(3)} y:${vec[1].toFixed(3)} z:${vec[2].toFixed(3)}`;

export const IkDebuggerPanel = ({
  urdfContent,
  robot,
  endEffectorLink,
  robotBoundingBox,
}: IkDebuggerPanelProps) => {
  const objects = useObjectStore((s) => s.objects);
  const ikTargetName = useIkDebugStore((s) => s.targetName);
  const status = useIkDebugStore((s) => s.status);
  const error = useIkDebugStore((s) => s.error);
  const isFollowingOrbit = useIkDebugStore((s) => s.isFollowingOrbit);
  const orbitFollowProgress = useIkDebugStore((s) => s.orbitFollowProgress);
  const durationMs = useIkDebugStore((s) => s.durationMs);
  const diagnostics = useIkDebugStore((s) => s.diagnostics);

  const ikTargets = useMemo(
    () => objects.filter((obj) => obj.isIkTarget),
    [objects]
  );

  const selectedTarget = useMemo(() => {
    if (ikTargetName) {
      return objects.find((obj) => obj.id === ikTargetName) ?? null;
    }
    return ikTargets[0] ?? null;
  }, [ikTargetName, ikTargets, objects]);

  const targetPosition = useMemo(() => {
    if (!selectedTarget) return null;

    if (selectedTarget.ikTargetType !== "orbit" || selectedTarget.orbitTargetPoint === "center") {
      return [selectedTarget.position.x, selectedTarget.position.y, selectedTarget.position.z] as [
        number,
        number,
        number,
      ];
    }

    const radius = selectedTarget.orbitRadius ?? IK_ORBIT_DEFAULTS.radius;
    const inclination = selectedTarget.orbitInclination ?? IK_ORBIT_DEFAULTS.inclinationDeg;
    const basePhase = selectedTarget.orbitPhase ?? IK_ORBIT_DEFAULTS.phaseDeg;
    const secondaryOffset =
      selectedTarget.orbitTargetPoint === "secondary"
        ? selectedTarget.orbitSecondaryOffset ?? IK_ORBIT_DEFAULTS.secondaryOffsetDeg
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
  }, [selectedTarget]);

  const solverLabel = useMemo(
    () => `auto (${DEFAULT_IK_SOLVER_CHAIN.join(", ")})`,
    []
  );

  const bboxSummary = useMemo(() => {
    if (!robotBoundingBox || robotBoundingBox.isEmpty()) return null;
    const size = new THREE.Vector3();
    robotBoundingBox.getSize(size);
    return {
      min: [robotBoundingBox.min.x, robotBoundingBox.min.y, robotBoundingBox.min.z] as [number, number, number],
      max: [robotBoundingBox.max.x, robotBoundingBox.max.y, robotBoundingBox.max.z] as [number, number, number],
      size: [size.x, size.y, size.z] as [number, number, number],
    };
  }, [robotBoundingBox]);

  return (
    <div className="space-y-2">
      <BlenderPanel title="IK" defaultOpen={true}>
        <div className="space-y-0.5">
          <BlenderPropertyRow label="Status">
            <span className="text-[10px] text-foreground">
              {status}
              {status === "error" && error ? `: ${error}` : ""}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Solver">
            <span className="text-[10px] text-foreground">{solverLabel}</span>
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
              {targetPosition ? formatVec3(targetPosition) : "-"}
            </span>
          </BlenderPropertyRow>
          <BlenderPropertyRow label="Mode">
            <span className="text-[10px] text-foreground">
              {selectedTarget?.ikTargetType ?? "-"}
            </span>
          </BlenderPropertyRow>
          {selectedTarget?.ikTargetType === "orbit" && (
            <BlenderPropertyRow label="Point">
              <span className="text-[10px] text-foreground">
                {selectedTarget?.orbitTargetPoint ?? "-"}
              </span>
            </BlenderPropertyRow>
          )}
          <BlenderPropertyRow label="Solve ms">
            <span className="text-[10px] font-mono text-foreground">
              {durationMs !== null ? durationMs.toFixed(0) : "-"}
            </span>
          </BlenderPropertyRow>
          {selectedTarget?.ikTargetType === "orbit" && (
            <>
              <BlenderPropertyRow label="Radius">
                <span className="text-[10px] font-mono text-foreground">
                  {selectedTarget.orbitRadius?.toFixed(3) ?? "-"}
                </span>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Incline">
                <span className="text-[10px] font-mono text-foreground">
                  {selectedTarget.orbitInclination?.toFixed(1) ?? "-"}
                </span>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Phase">
                <span className="text-[10px] font-mono text-foreground">
                  {selectedTarget.orbitPhase?.toFixed(1) ?? "-"}
                </span>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Offset">
                <span className="text-[10px] font-mono text-foreground">
                  {selectedTarget.orbitSecondaryOffset?.toFixed(1) ?? "-"}
                </span>
              </BlenderPropertyRow>
            </>
          )}
          {isFollowingOrbit && (
            <BlenderPropertyRow label="Orbit">
              <span className="text-[10px] font-mono text-foreground">
                {orbitFollowProgress.toFixed(0)}%
              </span>
            </BlenderPropertyRow>
          )}
          {diagnostics && (
            <>
              <BlenderPropertyRow label="Iter">
                <span className="text-[10px] font-mono text-foreground">
                  {diagnostics.iterations}
                </span>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Cost">
                <span className="text-[10px] font-mono text-foreground">
                  {diagnostics.cost.toFixed(4)}
                </span>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Term">
                <span className="text-[10px] text-foreground">
                  {diagnostics.termination_reason}
                </span>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Valid">
                <span className="text-[10px] text-foreground">
                  {diagnostics.validity}
                </span>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Degeneracy">
                <span className="text-[10px] text-foreground">
                  {diagnostics.degeneracy}
                </span>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Branch">
                <span className="text-[10px] text-foreground">
                  {diagnostics.branch_maybe ? "possible" : "expected"}
                </span>
              </BlenderPropertyRow>
            </>
          )}
        </div>
      </BlenderPanel>

      <BlenderPanel title="FK" defaultOpen={true}>
        <FkComparisonPanel
          urdfContent={urdfContent}
          robot={robot}
          endEffectorLink={endEffectorLink}
          showHeader={false}
          className="border-none bg-transparent p-0"
        />
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
