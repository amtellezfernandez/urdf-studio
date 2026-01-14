import { useCallback, type ChangeEvent } from "react";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";
import { parseEpisodeTextAsync } from "@/features/dataset";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import { resolveJointScalarValue } from "@/features/viewer/viewer-helpers";
import type { AnimationFrame } from "@/features/viewer/viewer-types";

type UseMotionDataUploadParams = {
  robot: URDFRobot | null;
  setAnimationFrames: (frames: AnimationFrame[] | null) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setMotionDataFile: (file: File | null) => void;
  setStoreJointValues: (values: Record<string, number>) => void;
  onMotionFileChange?: (file: File | null) => void;
};

export const useMotionDataUpload = ({
  robot,
  setAnimationFrames,
  setIsPlaying,
  setMotionDataFile,
  setStoreJointValues,
  onMotionFileChange,
}: UseMotionDataUploadParams) => {
  const parseMotionDataFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result as string;
        let sourceFrames:
          | { timestamp: number; joints: Record<string, number> }[]
          | undefined;
        let jointOrder: string[] | undefined;

        const parseResult = await parseEpisodeTextAsync(content);
        if (parseResult.error) {
          toast.error(parseResult.error);
          return;
        }

        if (parseResult.episodes && parseResult.episodes.length > 0) {
          const episode = parseResult.episodes[0];
          sourceFrames = episode.frames;
          jointOrder = episode.jointOrder;
          if (parseResult.episodes.length > 1) {
            toast.info(
              `Found ${parseResult.episodes.length} episodes in file; loading the first one`
            );
          }
        } else if (parseResult.frames) {
          sourceFrames = parseResult.frames;
          jointOrder = parseResult.jointOrder;
        } else {
          toast.error("Invalid motion data format");
          return;
        }

        if (!sourceFrames || sourceFrames.length === 0) {
          toast.error("No data rows found");
          return;
        }

        const robotAny = robot;
        const robotJointKeys: string[] = robotAny ? Object.keys(robotAny.joints || {}) : [];
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
                new Set(sourceFrames.flatMap((frame) => Object.keys(frame.joints)))
              )) ?? [];

        const mapping = new Map<string, string>();
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

        toast.success(`Loaded ${frames.length} frames with ${jointNames.length} joints`);
      };

      reader.readAsText(file);
    },
    [robot, setAnimationFrames, setIsPlaying, setStoreJointValues]
  );

  const handleMotionDataUpload = useCallback(
    (e: ChangeEvent<HTMLInputElement> | File) => {
      const file = e instanceof File ? e : e.target.files?.[0];
      if (file) {
        setMotionDataFile(file);
        parseMotionDataFile(file);
        onMotionFileChange?.(file);
        toast.success(`Motion data file uploaded: ${file.name}`);
      }
    },
    [onMotionFileChange, parseMotionDataFile, setMotionDataFile]
  );

  return { handleMotionDataUpload, parseMotionDataFile };
};
