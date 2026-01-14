import { useEffect, useRef, useState } from "react";
import type { URDFRobot } from "urdf-loader";
import {
  extractLinkPose,
  getLiveRobotJoints,
  positionDistance,
  quaternionAngularErrorDeg,
  toZeroIfTiny,
  type LinkPose,
} from "@/features/viewer/viewer-helpers";

type EndEffectorPoseState = {
  pyroki: LinkPose | null;
  three: LinkPose | null;
  positionError: number | null;
  rotationErrorDeg: number | null;
  error: string | null;
  lastUpdated: number | null;
  loading: boolean;
};

type UseEndEffectorPoseSyncParams = {
  robot: URDFRobot | null;
  urdfContent: string | null;
  endEffectorLink: string | null;
  storeJointValues: Record<string, number>;
  apiBaseUrl: string;
};

const emptyPoseState: EndEffectorPoseState = {
  pyroki: null,
  three: null,
  positionError: null,
  rotationErrorDeg: null,
  error: null,
  lastUpdated: null,
  loading: false,
};

export const useEndEffectorPoseSync = ({
  robot,
  urdfContent,
  endEffectorLink,
  storeJointValues,
  apiBaseUrl,
}: UseEndEffectorPoseSyncParams) => {
  const [endEffectorPose, setEndEffectorPose] =
    useState<EndEffectorPoseState>(emptyPoseState);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!robot || !urdfContent || !endEffectorLink) {
      setEndEffectorPose(emptyPoseState);
      return;
    }

    const timeoutId = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

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
        const response = await fetch(`${apiBaseUrl}/pyroki/fk`, {
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

        if (controller.signal.aborted || requestId !== requestIdRef.current) {
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

        const syncedThreePose = extractLinkPose(robot, endEffectorLink) ?? baseThreePose;

        const posError = pyrokiPose
          ? positionDistance(pyrokiPose.position, syncedThreePose.position)
          : null;
        const rotError = pyrokiPose
          ? quaternionAngularErrorDeg(pyrokiPose.quaternion, syncedThreePose.quaternion)
          : null;

        setEndEffectorPose({
          pyroki: pyrokiPose,
          three: syncedThreePose,
          positionError: toZeroIfTiny(
            posError !== null && Number.isFinite(posError) ? posError : null,
            1e-6
          ),
          rotationErrorDeg: toZeroIfTiny(
            rotError !== null && Number.isFinite(rotError) ? rotError : null,
            1e-4
          ),
          error: pyrokiPose ? null : "End-effector missing in PyRoki FK output",
          lastUpdated: Date.now(),
          loading: false,
        });
      } catch (err) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
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
      abortRef.current?.abort();
    };
  }, [apiBaseUrl, endEffectorLink, robot, storeJointValues, urdfContent]);

  return endEffectorPose;
};
