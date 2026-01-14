import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { AlertCircle } from "lucide-react";
import { API_BASE_URL } from "@/shared/config/api";
import { useJointStore } from "@/shared/store/useJointStore";
import { cn } from "@/shared/lib/utils";

type PoseData = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
};

interface FkComparisonPanelProps {
  urdfContent?: string | null;
  robot?: URDFRobot | null;
  endEffectorLink?: string | null;
  className?: string;
  showHeader?: boolean;
}

export const FkComparisonPanel = ({
  urdfContent,
  robot,
  endEffectorLink,
  className,
  showHeader = true,
}: FkComparisonPanelProps) => {
  const jointValues = useJointStore((s) => s.jointValues);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pyrokiPoses, setPyrokiPoses] = useState<Record<string, PoseData>>({});
  const [nodePoses, setNodePoses] = useState<Record<string, PoseData>>({});
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [source, setSource] = useState<"pyroki" | "node">("pyroki");
  const latestRequestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const computeComparison = useCallback(async () => {
    if (!urdfContent || !robot) return;

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
    const nextNode: Record<string, PoseData> = {};

    for (const linkName of linkNames) {
      const obj = threeLinks[linkName];
      if (!obj || !obj.matrixWorld) continue;
      tmpMatrix.copy(obj.matrixWorld);
      tmpMatrix.decompose(pos, quat, scale);

      nextNode[linkName] = {
        position: [pos.x, pos.y, pos.z],
        quaternion: [quat.w, quat.x, quat.y, quat.z],
      };
    }

    setNodePoses(nextNode);

    const requestId = ++latestRequestId.current;
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setIsChecking(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/pyroki/fk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          urdf: urdfContent,
          joint_values: jointValues,
        }),
      });

      if (!response.ok) {
        let message = "PyRoki FK API request failed";
        try {
          const data = await response.json();
          message = data.error || data.detail || data.message || message;
        } catch {
          // Ignore JSON parse errors
        }
        if (requestId === latestRequestId.current) {
          setError(message);
        }
        return;
      }

      const data = await response.json();
      if (requestId !== latestRequestId.current) {
        return;
      }

      const links = Array.isArray(data.links) ? data.links : [];
      const nextPyroki: Record<string, PoseData> = {};
      for (const link of links) {
        if (
          typeof link?.name === "string" &&
          Array.isArray(link.position) &&
          Array.isArray(link.quaternion_wxyz)
        ) {
          const [px, py, pz] = link.position;
          const [w, x, y, z] = link.quaternion_wxyz;
          if ([px, py, pz, w, x, y, z].every((v) => typeof v === "number")) {
            nextPyroki[link.name] = {
              position: [px, py, pz],
              quaternion: [w, x, y, z],
            };
          }
        }
      }

      setPyrokiPoses(nextPyroki);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      if (requestId === latestRequestId.current) {
        setError(
          err instanceof Error
            ? err.message
            : "Unknown error while running PyRoki FK comparison"
        );
      }
    } finally {
      if (requestId === latestRequestId.current) {
        setIsChecking(false);
      }
    }
  }, [jointValues, robot, urdfContent]);

  useEffect(() => {
    if (!urdfContent || !robot) {
      setError(null);
      setPyrokiPoses({});
      setNodePoses({});
      setSelectedLink(null);
      return;
    }

    const handle = requestAnimationFrame(() => {
      void computeComparison();
    });
    return () => cancelAnimationFrame(handle);
  }, [computeComparison, robot, urdfContent]);

  const linkNames = useMemo(() => {
    const names = new Set<string>();
    Object.keys(nodePoses).forEach((name) => names.add(name));
    Object.keys(pyrokiPoses).forEach((name) => names.add(name));
    return Array.from(names).sort();
  }, [nodePoses, pyrokiPoses]);

  useEffect(() => {
    if (selectedLink && linkNames.includes(selectedLink)) return;
    if (endEffectorLink && linkNames.includes(endEffectorLink)) {
      setSelectedLink(endEffectorLink);
      return;
    }
    setSelectedLink(linkNames[0] ?? null);
  }, [endEffectorLink, linkNames, selectedLink]);

  const pose = selectedLink
    ? source === "pyroki"
      ? pyrokiPoses[selectedLink]
      : nodePoses[selectedLink]
    : null;

  const showError = source === "pyroki" && error;

  return (
    <div className={cn("space-y-2 rounded-md border border-border/50 bg-background/70 p-2.5", className)}>
      {showHeader && (
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-[12px] font-semibold text-foreground">FK</div>
            {selectedLink && selectedLink === endEffectorLink && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground">
                EE
              </span>
            )}
          </div>
        </div>
      )}

      {!urdfContent || !robot ? (
        <div className="flex items-center justify-center h-24 text-[11px] text-muted-foreground">
          Load a robot and URDF to compare FK.
        </div>
      ) : showError ? (
        <div className="flex items-start gap-2 text-[10px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5" />
          <span className="whitespace-pre-wrap">PyRoki FK error: {error}</span>
        </div>
      ) : (
        <div className="space-y-2 text-[10px]">
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <label className="text-muted-foreground flex items-center gap-1">
              <span>Link</span>
              {selectedLink && selectedLink === endEffectorLink && (
                <span className="text-[9px] px-1 py-0.5 rounded border border-border/60 text-muted-foreground">
                  EE
                </span>
              )}
            </label>
            <label className="text-muted-foreground text-right">Source</label>
            <select
              value={selectedLink ?? ""}
              onChange={(event) => setSelectedLink(event.target.value || null)}
              className="h-6 rounded border border-border/60 bg-background px-2 text-[10px]"
            >
              {linkNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                  {name === endEffectorLink ? " (EE)" : ""}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                className={cn(
                  "h-6 px-2 rounded border text-[10px]",
                  source === "pyroki"
                    ? "border-border bg-muted/40 text-foreground"
                    : "border-transparent text-muted-foreground"
                )}
                onClick={() => setSource("pyroki")}
              >
                PyRoki
              </button>
              <button
                type="button"
                className={cn(
                  "h-6 px-2 rounded border text-[10px]",
                  source === "node"
                    ? "border-border bg-muted/40 text-foreground"
                    : "border-transparent text-muted-foreground"
                )}
                onClick={() => setSource("node")}
              >
                Node
              </button>
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-background/60 p-2 space-y-2">
            {!selectedLink ? (
              <div className="text-muted-foreground">No link selected.</div>
            ) : !pose ? (
              <div className="text-muted-foreground">Pose unavailable.</div>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-tight text-muted-foreground">
                    Position (m)
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[10px] text-foreground">
                    <span>x: {pose.position[0].toFixed(4)}</span>
                    <span>y: {pose.position[1].toFixed(4)}</span>
                    <span>z: {pose.position[2].toFixed(4)}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-tight text-muted-foreground">
                    Quaternion (wxyz)
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-foreground">
                    <span>w: {pose.quaternion[0].toFixed(4)}</span>
                    <span>x: {pose.quaternion[1].toFixed(4)}</span>
                    <span>y: {pose.quaternion[2].toFixed(4)}</span>
                    <span>z: {pose.quaternion[3].toFixed(4)}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
