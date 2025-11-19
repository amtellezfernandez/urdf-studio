import { useCallback, useEffect, useState, useRef } from "react";
import ReactFlow, {
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
} from "reactflow";
import "reactflow/dist/style.css";
import { NodeCard } from "./nodes/NodeCard";
import { Button } from "@/components/ui/button";
import { Square, X, Download } from "lucide-react";
import { useJointStore, type JointParameter } from "@/store/useJointStore";
import { toast } from "sonner";

interface RecordedFrame {
  timestamp: number;
  jointPositions: Record<string, number>;
}

const nodeTypes = {
  customNode: (props: any) => <NodeCard {...props} id={props.id} />,
};

// Custom edge component with delete button
const CustomEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd, data }: EdgeProps) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="group"
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 rounded-full bg-red-500/20 hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            onClick={(e) => {
              e.stopPropagation();
              data?.onDelete?.(id);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

const edgeTypes = {
  custom: CustomEdge,
};

interface NodeData {
  type: "joint";
  joints?: JointParameter[];
  onJointChange?: (jointName: string, value: number) => void;
  jointValues?: Record<string, number>;
  selectedJoint?: string | null;
  isFocused?: boolean;
  onDelete?: () => void;
}

interface NodeGraphProps {
  selectedJoint?: string | null;
  onJointChange?: (jointName: string, value: number) => void;
  jointValues?: Record<string, number>;
  onSelectJoint?: (jointName: string | null) => void;
  availableJoints?: string[];
  initialMotionNodes?: Node[];
  initialMotionEdges?: Edge[];
}

const initialNodes: Node<NodeData>[] = [];

const initialEdges: Edge[] = [];

export const NodeGraph = ({ selectedJoint, onJointChange, jointValues, onSelectJoint, availableJoints, initialMotionNodes = [], initialMotionEdges = [] }: NodeGraphProps = {}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  // Subscribe to store for live joint values
  const storeJointValues = useJointStore((s) => s.jointValues);
  const availableJointsStore = useJointStore((s) => s.availableJoints);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const getNodeState = useJointStore((s) => s.getNodeState);
  const setNodeState = useJointStore((s) => s.setNodeState);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedFrames, setRecordedFrames] = useState<RecordedFrame[]>([]);
  const recordingStartTime = useRef<number>(0);
  const recordingIntervalRef = useRef<number | null>(null);

  // Delete node callback
  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    if (focusedNodeId === nodeId) {
      setFocusedNodeId(null);
    }
  }, [setNodes, setEdges, focusedNodeId]);

  // Update all nodes with callbacks
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onJointChange,
          onDelete: () => handleDeleteNode(node.id),
        },
      }))
    );
  }, [onJointChange, handleDeleteNode, setNodes]);

  // Load imported motion nodes when they're provided
  useEffect(() => {
    if (initialMotionNodes.length > 0) {
      setNodes(initialMotionNodes);
      setEdges(initialMotionEdges);
    }
  }, [initialMotionNodes, initialMotionEdges, setNodes, setEdges]);

  // Only sync store values to focused node (for live feedback from 3D dragging)
  useEffect(() => {
    if (!focusedNodeId) return;
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          jointValues: node.id === focusedNodeId ? storeJointValues : node.data.jointValues,
        },
      }))
    );
  }, [storeJointValues, focusedNodeId, setNodes]);

  // Sync selected joint into nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          selectedJoint,
          isFocused: node.id === focusedNodeId,
        },
      }))
    );
  }, [selectedJoint, focusedNodeId, setNodes]);

  // Initialize node states in store and seed empty joint nodes
  useEffect(() => {
    if (!availableJointsStore || availableJointsStore.length === 0) return;

    nodes.forEach((node) => {
      const existingState = getNodeState(node.id);
      if (!existingState && (node.data as any)?.type === 'joint') {
        // Use existing joints from node data if available, otherwise seed from store
        const existingJoints = (node.data as any)?.joints;
        const joints = existingJoints && existingJoints.length > 0
          ? existingJoints
          : availableJointsStore.map((name) => ({
            name,
            value: typeof storeJointValues[name] === 'number' ? storeJointValues[name] : 0,
          }));
        setNodeState(node.id, {
          id: node.id,
          type: 'joint',
          joints,
        });
      }
    });
  }, [availableJointsStore, storeJointValues, nodes, getNodeState, setNodeState]);

  // Sync node data from store
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const nodeState = getNodeState(node.id);
        if (nodeState) {
          return {
            ...node,
            data: {
              ...node.data,
              joints: nodeState.joints,
            },
          };
        }
        return node;
      })
    );
  }, [getNodeState, setNodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, type: 'custom' }, eds)),
    [setEdges]
  );

  const onDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((edge) => edge.id !== edgeId));
      toast.success("Connection removed");
    },
    [setEdges]
  );

  // Add onDelete prop to all edges
  const edgesWithDelete = edges.map(edge => ({
    ...edge,
    data: { ...edge.data, onDelete: onDeleteEdge }
  }));

  const handleNodeChange = useCallback((nodeId: string, newData: Partial<NodeData>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              ...newData,
              onJointChange, // Pass the callback down to NodeCard
            },
          };
        }
        return node;
      })
    );
  }, [setNodes, onJointChange]);

  const addNode = useCallback((position?: { x: number; y: number }) => {
    // Check if URDF is loaded by checking if there are available joints
    if (!availableJointsStore || availableJointsStore.length === 0) {
      toast.error("Please upload a URDF file first");
      return;
    }

    const timestamp = Date.now();
    const seededJoints: JointParameter[] = (availableJointsStore || []).map((name) => ({
      name,
      value: typeof storeJointValues[name] === 'number' ? (storeJointValues as any)[name] : 0,
    }));

    // Use provided position or fallback to mouse position or default
    const nodePosition = position || mousePosition || { x: 300, y: 200 };

    const newNode: Node<NodeData> = {
      id: `node-${timestamp}`,
      type: "customNode",
      position: nodePosition,
      data: {
        type: "joint",
        joints: seededJoints,
        onJointChange,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes, onJointChange, availableJointsStore, storeJointValues, mousePosition]);

  // Recording functions
  const startRecording = useCallback(() => {
    // Stop all replay/playback
    (window as any).viewer3dStopAnimation?.();
    
    // Reset frame counters to beginning
    (window as any).viewer3dSetFrame?.(0);
    
    // Start recording
    setIsRecording(true);
    setRecordedFrames([]);
    recordingStartTime.current = Date.now();

    // Record at 50Hz (every 20ms)
    recordingIntervalRef.current = window.setInterval(() => {
      const timestamp = Date.now() - recordingStartTime.current;
      // Get fresh joint values from store each time (not from closure)
      const currentJointValues = useJointStore.getState().jointValues;
      setRecordedFrames(prev => [...prev, {
        timestamp,
        jointPositions: { ...currentJointValues }
      }]);
    }, 20);

    toast.success('Started recording animation');
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    toast.success(`Stopped recording. Captured ${recordedFrames.length} frames`);
  }, [recordedFrames.length]);

  const exportToCSV = useCallback(() => {
    if (recordedFrames.length === 0) {
      toast.error('No recorded data to export');
      return;
    }

    // Get available joints from store (should match robot joints)
    const joints = availableJointsStore.length > 0 
      ? [...availableJointsStore].sort((a, b) => {
          // Sort numeric joints numerically, others alphabetically
          const aNum = Number(a);
          const bNum = Number(b);
          if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
          return a.localeCompare(b);
        })
      : ['1', '2', '3', '4', '5']; // Fallback joint names

    // Build CSV header: timestamp, joint1, joint2, joint3, joint4, joint5
    // Using "joint1" format for consistency and easy parsing
    const headers = ['timestamp', ...joints.map(j => `joint${j}`)];
    const csvRows = [headers.join(',')];

    // Add data rows - timestamp in milliseconds, joint values in radians
    for (const frame of recordedFrames) {
      const row = [
        frame.timestamp, // Already in milliseconds
        ...joints.map(j => {
          const value = frame.jointPositions[j] ?? 0;
          // Ensure radians (values should already be in radians)
          return value;
        })
      ];
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');

    // Download the CSV file
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `urdf_animation_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported CSV with ${recordedFrames.length} frames`);
  }, [recordedFrames, availableJointsStore]);

  // Cleanup recording interval on unmount
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);



  return (
    <div className="flex-1 bg-background relative w-full h-full overflow-hidden">
      {/* Recording Controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1.5">
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={isRecording ? "destructive" : "outline"}
            className="text-xs h-7 px-2 shadow-sm"
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? (
              <>
                <Square className="w-3 h-3 mr-0.5 fill-current" />
                Stop
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1" />
                Rec
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 px-2 shadow-sm"
            onClick={exportToCSV}
            disabled={recordedFrames.length === 0}
            title={`Export ${recordedFrames.length} frames`}
          >
            <Download className="w-3 h-3" />
            {recordedFrames.length > 0 && (
              <span className="ml-0.5 text-[10px]">{recordedFrames.length}</span>
            )}
          </Button>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edgesWithDelete}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onMouseMove={(event) => {
          // Track mouse position for node placement
          const rect = event.currentTarget.getBoundingClientRect();
          setMousePosition({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
          });
        }}
        onNodeClick={(_, node) => {
          const prevFocused = focusedNodeId;
          setFocusedNodeId(node.id);
          if ((node.data as any)?.type === 'joint') {
            // Get the latest joints from store
            const nodeState = getNodeState(node.id);
            const joints = nodeState?.joints || (node.data as any)?.joints as JointParameter[] | undefined;
            if (joints && joints.length > 0) {
              // Only apply pose if switching from a different node
              if (prevFocused !== node.id) {
                const pose = Object.fromEntries(joints.map((j) => [j.name, j.value])) as Record<string, number>;
                setStoreJointValues(pose);
              }
              onSelectJoint?.(joints[0].name);
            }
          }
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        className="bg-background w-full h-full"
        style={{ width: "100%", height: "100%" }}
        defaultEdgeOptions={{
          type: 'custom',
          animated: false,
          style: { stroke: 'hsl(var(--border))', strokeWidth: 1.5 }
        }}
      >
        <Background color="hsl(var(--border))" gap={12} size={0.4} />
      </ReactFlow>
    </div>
  );
};
