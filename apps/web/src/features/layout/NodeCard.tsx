import { Handle, Position } from "reactflow";
import { Slider } from "@/shared/ui/slider";
import { Button } from "@/shared/ui/button";
import { useEffect, useMemo } from "react";
import { useJointStore, type JointParameter } from "@/shared/store/useJointStore";
import { X } from "lucide-react";

interface NodeCardProps {
  id: string;
  data: {
    type: "joint";
    joints?: JointParameter[];
    onJointChange?: (jointName: string, value: number) => void;
    jointValues?: Record<string, number>;
    selectedJoint?: string | null;
    isFocused?: boolean;
    onDelete?: () => void;
  };
}

export const NodeCard = ({ id, data }: NodeCardProps) => {
  const setJointValueStore = useJointStore((s) => s.setJointValue);
  const previewJointValue = useJointStore((s) => s.previewJointValue);
  const updateNodeJoints = useJointStore((s) => s.updateNodeJoints);
  const getNodeState = useJointStore((s) => s.getNodeState);
  const setNodeState = useJointStore((s) => s.setNodeState);
  const activeNodeId = useJointStore((s) => s.activeNodeId);
  const isAnimating = useJointStore((s) => s.isAnimating);
  const isActive = activeNodeId === id;

  // Initialize node state in store if not present
  useEffect(() => {
    const existingState = getNodeState(id);
    if (!existingState) {
      setNodeState(id, {
        id,
        type: data.type,
        joints: data.joints || [],
      });
    }
  }, [id, data.type, data.joints, getNodeState, setNodeState]);

  // Get state from store
  const nodeState = getNodeState(id);
  const localJoints = useMemo(
    () => nodeState?.joints || data.joints || [],
    [nodeState?.joints, data.joints]
  );

  // Sync external joint values into store (only when focused for live URDF updates)
  useEffect(() => {
    if (!localJoints.length || !data.jointValues || !data.isFocused || isAnimating) return;
    const updatedJoints = localJoints.map((j) => ({
      ...j,
      value: data.jointValues?.[j.name] ?? j.value,
    }));
    updateNodeJoints(id, updatedJoints);
  }, [data.jointValues, data.isFocused, id, localJoints, updateNodeJoints, isAnimating]);

  return (
      <div className={`node-card min-w-[280px] max-w-[320px] relative transition-all group ${data.isFocused ? 'ring-2 ring-primary/50' : ''} ${isActive ? 'ring-4 ring-primary shadow-lg shadow-primary/50 scale-105' : ''}`}>
        <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-border" />

        {data.onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute -top-2 -right-2 h-5 w-5 p-0 rounded-full bg-destructive hover:bg-destructive text-white z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            onClick={(e) => {
              e.stopPropagation();
              data.onDelete?.();
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        <div className="space-y-3">
          {localJoints.map((joint, idx) => (
            <div key={idx} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">
                  {joint.name}
                </label>
                <span className="text-[10px] text-muted-foreground/60">
                  {joint.value.toFixed(2)} rad
                </span>
              </div>
              <Slider
                value={[joint.value]}
                onValueChange={(value) => {
                  const limited = previewJointValue(joint.name, value[0]);
                  const newJoints = [...localJoints];
                  newJoints[idx].value = limited;
                  updateNodeJoints(id, newJoints);
                  setJointValueStore(joint.name, limited);
                  data.onJointChange?.(joint.name, limited);
                }}
                min={-3.14}
                max={3.14}
                step={0.01}
                className="w-full"
              />
            </div>
          ))}
        </div>

        <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-border" />
      </div>
  );
};
