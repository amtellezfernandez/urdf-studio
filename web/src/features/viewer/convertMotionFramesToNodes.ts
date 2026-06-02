import type { Edge, Node } from "reactflow";
import type { AnimationFrame } from "@/features/viewer/viewer-types";

type ConvertMotionFramesParams = {
  frames: AnimationFrame[];
  onJointChange?: (jointName: string, value: number) => void;
};

export const convertMotionFramesToNodes = ({
  frames,
  onJointChange,
}: ConvertMotionFramesParams): { nodes: Node[]; edges: Edge[] } => {
  if (!frames || frames.length === 0) return { nodes: [], edges: [] };

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  frames.forEach((frame, index) => {
    const joints = Object.entries(frame.joints).map(([name, value]) => ({
      name,
      value,
    }));

    nodes.push({
      id: `motion-keyframe-${index}`,
      type: "customNode",
      position: {
        x: 100 + index * 200,
        y: 100 + (index % 3) * 150,
      },
      data: {
        type: "joint",
        joints,
        onJointChange,
        onDelete: () => {
          // Placeholder for node deletion from imported frames.
        },
        isImportedNode: true,
        timestamp: frame.timestamp,
        frameIndex: index,
      },
      hidden: true,
    });

    if (index > 0) {
      edges.push({
        id: `motion-edge-${index - 1}-${index}`,
        source: `motion-keyframe-${index - 1}`,
        target: `motion-keyframe-${index}`,
        type: "custom",
        data: {
          onDelete: () => {
            // Placeholder for edge deletion from imported frames.
          },
        },
        hidden: true,
      });
    }
  });

  return { nodes, edges };
};
