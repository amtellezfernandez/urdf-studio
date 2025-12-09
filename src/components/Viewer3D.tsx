import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import URDFLoader from "urdf-loader";
import { toast } from "sonner";
import { useJointStore } from "@/store/useJointStore";
import { useObjectStore } from "@/store/useObjectStore";
import type { Node, Edge } from "reactflow";
import { getJointLimits, type JointLimits } from "@/urdf_corrections/parseJointLimits";
import type { JointAxisMap } from "@/urdf_corrections/parseJointAxis";
import jointColors from "@/joint_colors.json";
import { AxisGizmo3D } from "@/components/AxisGizmo3D";
import { CustomAxesHelper } from "@/components/CustomAxesHelper";
import { CameraIcons } from "@/components/CameraIcons";
import { CameraViewButtons } from "@/components/CameraViewButtons";
import { useCameraStore } from "@/store/useCameraStore";
import { parseEpisodeCsv } from "@/utils/episodeCsv";
import { parseEpisodeJson } from "@/utils/episodeFormat";
import type { CollisionVisibility } from "@/components/LinkEditor";
import { cn } from "@/lib/utils";
import { useGPUMode, type GPUMode } from "@/hooks/use-gpu-mode";

interface Viewer3DProps {
  urdfFile: File | null;
  initialMeshFiles?: MeshFiles;
  selectedJoint?: string | null;
  jointValues?: Record<string, number>;
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  onJointSelect?: (jointName: string | null) => void;
  onJointChange?: (jointName: string, value: number) => void;
  onRobotJointsLoaded?: (
    joints: string[],
    angles: Record<string, number>
  ) => void;
  onMotionDataNodesGenerated?: (nodes: Node[], edges: Edge[]) => void;
  onMotionFileChange?: (file: File | null) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onAnimationFramesChange?: (hasFrames: boolean) => void;
  onFrameChange?: (currentFrame: number, totalFrames: number) => void;
  collisionVisibility?: CollisionVisibility;
  rotationPlaneVisible?: boolean;
  onRobotBoundingBoxChange?: (boundingBox: THREE.Box3 | null) => void;
}

interface MeshFiles {
  [key: string]: Blob;
}

interface AnimationFrame {
  timestamp: number;
  joints: Record<string, number>;
}

interface URDFRobot {
  joints: Record<string, any>;
  setJointValue: (jointName: string, value: number) => void;
  setJointValues: (values: Record<string, number>) => void;
  position: THREE.Vector3;
  scale: THREE.Vector3;
}

// Component to render collision geometries from URDF
const CollisionGeometries = ({
  urdfFile,
  meshFiles,
  collisionVisibility,
  robot,
  gpuMode = "high",
}: {
  urdfFile: File;
  meshFiles: MeshFiles;
  collisionVisibility: CollisionVisibility;
  robot: URDFRobot | null;
  gpuMode?: GPUMode;
}) => {
  const [urdfContent, setUrdfContent] = useState<string>("");
  const collisionGroupRef = useRef<THREE.Group>(null);
  const collisionMeshesRef = useRef<Map<string, { mesh: THREE.Mesh; linkName: string; localXyz: [number, number, number]; localRpy: [number, number, number] }>>(new Map());

  // Read URDF content
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setUrdfContent(content);
    };
    reader.readAsText(urdfFile);
  }, [urdfFile]);

  // Parse and render collision geometries
  useEffect(() => {
    if (!urdfContent || !collisionGroupRef.current || !robot) return;

    // Clear existing collision geometries
    collisionMeshesRef.current.forEach(({ mesh }) => {
      if (mesh.material) (mesh.material as any).dispose();
      if (mesh.geometry) mesh.geometry.dispose();
      collisionGroupRef.current?.remove(mesh);
    });
    collisionMeshesRef.current.clear();

    while (collisionGroupRef.current.children.length > 0) {
      const child = collisionGroupRef.current.children[0];
      if (child instanceof THREE.Mesh && (child as any).userData?.isCollisionGeometry) {
        (child as any).material?.dispose();
        (child as any).geometry?.dispose();
      }
      collisionGroupRef.current.remove(child);
    }

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) return;

      const robotElement = xmlDoc.querySelector("robot");
      if (!robotElement) return;

      // Update robot matrix world to get current link positions
      const robotObject = robot as any;
      if (robotObject.updateMatrixWorld) {
        robotObject.updateMatrixWorld(true);
      }

      const links = xmlDoc.querySelectorAll("link");
      const isLowGPU = gpuMode === "low";

      // Create translucent grey material
      // Use same rendering settings as rotation plane to ensure visibility
      const collisionMaterial = isLowGPU
        ? new THREE.MeshBasicMaterial({
            color: 0x808080,
            opacity: 0.3,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false,
          })
        : new THREE.MeshStandardMaterial({
            color: 0x808080,
            opacity: 0.3,
            transparent: true,
            metalness: 0.1,
            roughness: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false,
          });

      // Helper function to apply link transformation to mesh
      const applyLinkTransform = (mesh: THREE.Mesh, linkName: string, localXyz: [number, number, number], localRpy: [number, number, number]) => {
        // Get the link object from robot
        const linkObject = robotObject.links?.[linkName] ?? robotObject.getObjectByName?.(linkName);
        
        if (linkObject) {
          // Update link's world matrix
          linkObject.updateMatrixWorld(true);
          const linkWorldMatrix = new THREE.Matrix4().copy(linkObject.matrixWorld);
          
          // Create local transform from collision origin
          const localMatrix = new THREE.Matrix4();
          localMatrix.makeRotationFromEuler(new THREE.Euler(localRpy[0], localRpy[1], localRpy[2], 'XYZ'));
          localMatrix.setPosition(new THREE.Vector3(localXyz[0], localXyz[1], localXyz[2]));
          
          // Combine: world = linkWorld * local
          linkWorldMatrix.multiply(localMatrix);
          
          // Extract position and rotation from combined matrix
          const worldPosition = new THREE.Vector3();
          const worldRotation = new THREE.Euler();
          const worldScale = new THREE.Vector3();
          linkWorldMatrix.decompose(worldPosition, worldRotation, worldScale);
          
          mesh.position.copy(worldPosition);
          mesh.rotation.copy(worldRotation);
        } else {
          // Fallback: just use local transform if link not found
          mesh.position.set(localXyz[0], localXyz[1], localXyz[2]);
          mesh.rotation.set(localRpy[0], localRpy[1], localRpy[2]);
        }
      };

      links.forEach((link) => {
        const linkName = link.getAttribute("name");
        if (!linkName) return;

        const linkVisibility = collisionVisibility[linkName];
        if (!linkVisibility) return;

        const collisions = link.querySelectorAll("collision");
        collisions.forEach((collision, index) => {
          const isVisible = linkVisibility[index] ?? false;
          if (!isVisible) return;

          // Get origin (local to link)
          const origin = collision.querySelector("origin");
          const xyz = (origin?.getAttribute("xyz")?.split(" ").map(parseFloat) || [0, 0, 0]) as [number, number, number];
          const rpy = (origin?.getAttribute("rpy")?.split(" ").map(parseFloat) || [0, 0, 0]) as [number, number, number];

          // Get geometry
          const geometryEl = collision.querySelector("geometry");
          if (!geometryEl) return;

          let mesh: THREE.Mesh | null = null;

          // Check geometry type
          const box = geometryEl.querySelector("box");
          const sphere = geometryEl.querySelector("sphere");
          const cylinder = geometryEl.querySelector("cylinder");
          const meshEl = geometryEl.querySelector("mesh");

          if (box) {
            const sizeStr = box.getAttribute("size");
            const size = sizeStr?.split(" ").map(parseFloat) || [1, 1, 1];
            const boxGeometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
            mesh = new THREE.Mesh(boxGeometry, collisionMaterial.clone());
            mesh.renderOrder = 999;
          } else if (sphere) {
            const radius = parseFloat(sphere.getAttribute("radius") || "1");
            const sphereGeometry = new THREE.SphereGeometry(radius, 32, 32);
            mesh = new THREE.Mesh(sphereGeometry, collisionMaterial.clone());
            mesh.renderOrder = 999;
          } else if (cylinder) {
            const radius = parseFloat(cylinder.getAttribute("radius") || "1");
            const length = parseFloat(cylinder.getAttribute("length") || "1");
            const cylinderGeometry = new THREE.CylinderGeometry(radius, radius, length, 32);
            mesh = new THREE.Mesh(cylinderGeometry, collisionMaterial.clone());
            mesh.renderOrder = 999;
          } else if (meshEl) {
            // For mesh collision geometries, load the mesh file
            const filename = meshEl.getAttribute("filename");
            const scaleStr = meshEl.getAttribute("scale");
            const scale = scaleStr?.split(" ").map(parseFloat) || [1, 1, 1];

            if (filename) {
              // Try to find the mesh file
              const filenameOnly = filename.split("/").pop() || filename;
              const meshBlob = meshFiles[filenameOnly] || meshFiles[filename];

              if (meshBlob) {
                // Load mesh asynchronously
                const blobUrl = URL.createObjectURL(meshBlob);
                const stlLoader = new STLLoader();
                stlLoader.load(
                  blobUrl,
                  (geometry) => {
                    geometry.scale(scale[0], scale[1], scale[2]);
                    const loadedMesh = new THREE.Mesh(geometry, collisionMaterial.clone());
                    loadedMesh.renderOrder = 999;
                    applyLinkTransform(loadedMesh, linkName, xyz, rpy);
                    (loadedMesh as any).userData.isCollisionGeometry = true;
                    (loadedMesh as any).userData.linkName = linkName;
                    collisionGroupRef.current?.add(loadedMesh);
                    // Store reference for frame updates
                    const meshKey = `${linkName}_${index}`;
                    collisionMeshesRef.current.set(meshKey, { mesh: loadedMesh, linkName, localXyz: xyz, localRpy: rpy });
                    URL.revokeObjectURL(blobUrl);
                  },
                  undefined,
                  (err) => {
                    console.error(`Error loading collision mesh ${filename}:`, err);
                    URL.revokeObjectURL(blobUrl);
                  }
                );
              }
              return; // Skip synchronous mesh creation for mesh files
            }
          }

          if (mesh) {
            mesh.renderOrder = 999;
            applyLinkTransform(mesh, linkName, xyz, rpy);
            (mesh as any).userData.isCollisionGeometry = true;
            (mesh as any).userData.linkName = linkName;
            collisionGroupRef.current.add(mesh);
            // Store reference for frame updates
            const meshKey = `${linkName}_${index}`;
            collisionMeshesRef.current.set(meshKey, { mesh, linkName, localXyz: xyz, localRpy: rpy });
          }
        });
      });
    } catch (error) {
      console.error("Error rendering collision geometries:", error);
    }
  }, [urdfContent, collisionVisibility, robot, gpuMode, meshFiles]);

  // Update collision geometry transforms every frame to follow robot movement
  useFrame(() => {
    if (!collisionGroupRef.current || !robot) return;

    const robotObject = robot as any;
    if (robotObject.updateMatrixWorld) {
      robotObject.updateMatrixWorld(true);
    }

    // Update each collision mesh transform based on its link's current world position
    collisionMeshesRef.current.forEach(({ mesh, linkName, localXyz, localRpy }) => {
      const linkObject = robotObject.links?.[linkName] ?? robotObject.getObjectByName?.(linkName);
      
      if (linkObject) {
        linkObject.updateMatrixWorld(true);
        const linkWorldMatrix = new THREE.Matrix4().copy(linkObject.matrixWorld);
        
        // Create local transform from collision origin
        const localMatrix = new THREE.Matrix4();
        localMatrix.makeRotationFromEuler(new THREE.Euler(localRpy[0], localRpy[1], localRpy[2], 'XYZ'));
        localMatrix.setPosition(new THREE.Vector3(localXyz[0], localXyz[1], localXyz[2]));
        
        // Combine: world = linkWorld * local
        linkWorldMatrix.multiply(localMatrix);
        
        // Extract position and rotation from combined matrix
        const worldPosition = new THREE.Vector3();
        const worldRotation = new THREE.Euler();
        const worldScale = new THREE.Vector3();
        linkWorldMatrix.decompose(worldPosition, worldRotation, worldScale);
        
        mesh.position.copy(worldPosition);
        mesh.rotation.copy(worldRotation);
      }
    });
  });

  return <group ref={collisionGroupRef} renderOrder={999} />;
};

// Component for a dynamic line that tracks a joint position
const TrackingLine = ({
  cubePos,
  robot,
  trackedJointName,
  gpuMode = "high",
}: {
  cubePos: THREE.Vector3;
  robot: URDFRobot | null;
  trackedJointName: string | null;
  gpuMode?: GPUMode;
}) => {
  const lineRef = useRef<THREE.Line>(null);

  useFrame(() => {
    if (!robot || !lineRef.current) return;

    let targetPos: THREE.Vector3 | null = null;

    // If there's a tracked joint, use its center position
    if (trackedJointName) {
      try {
        const joint = (robot as any).joints?.[trackedJointName];
        if (joint) {
          // Update joint's world matrix to get current position
          joint.updateWorldMatrix(true, true);
          
          // Get the world position of the joint
          targetPos = new THREE.Vector3();
          joint.getWorldPosition(targetPos);
        }
      } catch (error) {
        console.error("Error getting joint world position:", error);
      }
    }

    // If no tracked joint or joint not found, calculate closest point on robot
    if (!targetPos) {
      const robotMeshes: THREE.Mesh[] = [];
      (robot as any).traverse((child: any) => {
        if (child.isMesh) {
          robotMeshes.push(child);
        }
      });

      if (robotMeshes.length > 0) {
        let minDistance = Infinity;
        let closestPoint = new THREE.Vector3();

        robotMeshes.forEach((mesh) => {
          mesh.geometry.computeBoundingBox();
          if (!mesh.geometry.boundingBox) return;

          const robotBox = mesh.geometry.boundingBox.clone();
          robotBox.applyMatrix4(mesh.matrixWorld);

          const robotCenter = new THREE.Vector3();
          robotBox.getCenter(robotCenter);
          const cubeCenter = cubePos.clone();

          const distance = robotCenter.distanceTo(cubeCenter);
          if (distance < minDistance) {
            minDistance = distance;
            closestPoint.copy(robotCenter);
          }
        });

        targetPos = closestPoint;
      } else {
        return; // No robot meshes, don't draw line
      }
    }

    // Update line geometry
    const geometry = lineRef.current.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    if (positions && targetPos) {
      positions.array[0] = cubePos.x;
      positions.array[1] = cubePos.y;
      positions.array[2] = cubePos.z;
      positions.array[3] = targetPos.x;
      positions.array[4] = targetPos.y;
      positions.array[5] = targetPos.z;
      positions.needsUpdate = true;
    }
  });

  return (
    <line ref={lineRef} renderOrder={1000}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={2}
          array={new Float32Array([
            cubePos.x,
            cubePos.y,
            cubePos.z,
            cubePos.x,
            cubePos.y,
            cubePos.z,
          ])}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial 
        color="#ff00ff" 
        linewidth={2} 
        opacity={0.7} 
        transparent 
        depthTest={false}
        depthWrite={false}
      />
    </line>
  );
};

// Component to render created objects and distance lines
const CreatedObjects = ({
  robot,
  gpuMode = "high",
}: {
  robot: URDFRobot | null;
  gpuMode?: GPUMode;
}) => {
  const objects = useObjectStore((state) => state.objects);
  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const setSelectedObject = useObjectStore((state) => state.setSelectedObject);

  // Handle pointer down on cube (just for selection, no dragging)
  const handlePointerDown = useCallback((e: any, objectId: string) => {
    e.stopPropagation();
    setSelectedObject(objectId);
  }, [setSelectedObject]);

  return (
    <group>
      {objects.map((obj) => {
        const isSelected = obj.id === selectedObjectId;

        return (
          <group key={obj.id}>
            {/* Cube mesh */}
            <mesh
              position={[obj.position.x, obj.position.y, obj.position.z]}
              onPointerDown={(e) => handlePointerDown(e, obj.id)}
            >
              <boxGeometry args={[obj.size.x, obj.size.y, obj.size.z]} />
              <meshStandardMaterial
                color={obj.color}
                transparent={true}
                opacity={isSelected ? 0.8 : 0.6}
                emissive={isSelected ? obj.color : "#000000"}
                emissiveIntensity={isSelected ? 0.3 : 0}
              />
            </mesh>

            {/* Wireframe outline */}
            <lineSegments
              position={[obj.position.x, obj.position.y, obj.position.z]}
            >
              <edgesGeometry args={[new THREE.BoxGeometry(obj.size.x, obj.size.y, obj.size.z)]} />
              <lineBasicMaterial color={isSelected ? "#ffffff" : "#aaaaaa"} linewidth={2} />
            </lineSegments>

            {/* Distance visualization line - points to tracked joint center or closest robot point */}
            {robot && (
              <TrackingLine
                cubePos={obj.position}
                robot={robot}
                trackedJointName={obj.trackedJointName}
                gpuMode={gpuMode}
              />
            )}
          </group>
        );
      })}
    </group>
  );
};

const URDFModel = ({
  file,
  meshFiles,
  animationFrames,
  isPlaying,
  onRobotLoaded,
  selectedJoint,
  onSelectPart,
  onJointChange,
  onDragActiveChange,
  onFrameChange,
  jointLimits,
  jointAxes,
  gpuMode = "high",
  playbackSpeed = 1.0,
  rotationPlaneVisible = false,
}: {
  file: File;
  meshFiles: MeshFiles;
  animationFrames: AnimationFrame[] | null;
  isPlaying: boolean;
  onRobotLoaded: (robot: any) => void;
  selectedJoint?: string | null;
  onSelectPart?: (payload: {
    linkName?: string;
    jointName?: string | null;
  }) => void;
  onJointChange?: (jointName: string, value: number) => void;
  onDragActiveChange?: (active: boolean) => void;
  onFrameChange?: (frameIndex: number) => void;
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  gpuMode?: GPUMode;
  playbackSpeed?: number;
  rotationPlaneVisible?: boolean;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const robotRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const animationStartTime = useRef<number>(0);
  const manualFrameTimeRef = useRef<number | null>(null); // For manual frame navigation
  const blobUrlsRef = useRef<string[]>([]);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
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

    const loader = new URDFLoader();

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
          
          // Apply slight scale to visual meshes to reduce apparent collisions
          // Visual meshes often include tolerances/padding that cause overlaps
          // A 1% scale reduction helps visualize actual clearances
          mesh.scale.setScalar(0.99);

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
        
        const robot = loader.parse(content) as any;
        if (groupRef.current && robot) {
          // Clear previous model
          while (groupRef.current.children.length > 0) {
            groupRef.current.remove(groupRef.current.children[0]);
          }
          groupRef.current.add(robot);

          // Keep URDF Z-up to match imported animation data axes; no rotation

          // Scale to fit within a reasonable view size, but don't fix position
          const box = new THREE.Box3().setFromObject(robot);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);

          if (maxDim > 0 && isFinite(maxDim)) {
            const scale = 2 / maxDim;
            robot.scale.setScalar(scale);
            // After scaling, recalculate center for camera positioning
            box.setFromObject(robot);
            box.getCenter(center);
          } else {
            robot.scale.setScalar(1);
          }

          // Store robot center for camera positioning (don't move the robot itself)
          // The robot will remain at its natural position, allowing free movement
          (robot as any).userData.boundingBoxCenter = center.clone();
          (robot as any).userData.isURDFRobot = true;

          robotRef.current = robot;
          onRobotLoaded(robot);
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
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [file, meshFiles, onRobotLoaded]);

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
    const preservedFrameTime = (window as any).__viewer3dPreserveFrameTime;
    if (preservedFrameTime !== undefined && preservedFrameTime !== null) {
      // Use preserved frame time and convert to normalized time
      const frameIndex = Math.round((preservedFrameTime - firstTimestamp) / normalizedFrameDuration);
      const clampedFrameIndex = Math.max(0, Math.min(frameIndex, animationFrames.length - 1));
      const normalizedTime = firstTimestamp + clampedFrameIndex * normalizedFrameDuration;
      currentTime = normalizedTime;
      manualFrameTimeRef.current = normalizedTime;
      // Update frame index immediately to prevent wrong frame from being displayed
      (window as any).__viewer3dCurrentFrameIndex = clampedFrameIndex;
      currentFrameIndexRef.current = clampedFrameIndex;
      // Immediately update frame callback with correct frame to prevent UI flicker
      if (onFrameChange) {
        onFrameChange(clampedFrameIndex);
      }
      // Clear the window property after using it
      delete (window as any).__viewer3dPreserveFrameTime;
      shouldApplyAnimation = true;
      // Set a flag to skip the normal frame update logic below
      (window as any).__viewer3dSkipFrameUpdate = true;
    }
    
    // Check for manual frame time from window (set by handleSetFrame or timeline scrubbing)
    const manualFrameTime = (window as any).__viewer3dManualFrameTime;
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
      (window as any).__viewer3dCurrentFrameIndex = targetFrameIndex;
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
      delete (window as any).__viewer3dManualFrameTime;
      shouldApplyAnimation = true; // Apply when manually setting frame
      // Set pause flag to prevent interpolation
      (window as any).__viewer3dIsPaused = true;
      // Set flag to skip normal frame update
      (window as any).__viewer3dSkipFrameUpdate = true;
    } else if (manualFrameTimeRef.current !== null) {
      // Use stored manual frame time (paused at a specific frame)
      currentTime = manualFrameTimeRef.current;
      // Calculate frame index from stored time to keep it consistent
      const storedFrameIndex = Math.round((currentTime - firstTimestamp) / normalizedFrameDuration);
      const clampedStoredIndex = Math.max(0, Math.min(storedFrameIndex, animationFrames.length - 1));
      (window as any).__viewer3dCurrentFrameIndex = clampedStoredIndex;
      // If we start playing from a paused state, update start time and clear manual frame
      if (isPlaying) {
        // The stored time is already normalized, so use it directly
        animationStartTime.current = Date.now() - (currentTime - firstTimestamp) / playbackSpeed;
        manualFrameTimeRef.current = null;
        shouldApplyAnimation = true;
        // Clear pause flag when starting to play
        delete (window as any).__viewer3dIsPaused;
      } else {
        // Paused with manual frame time - stay at this exact frame (no interpolation)
        shouldApplyAnimation = true;
        // Store a flag to indicate we're paused so we don't interpolate
        (window as any).__viewer3dIsPaused = true;
        // Set flag to skip normal frame update to prevent recalculation
        (window as any).__viewer3dSkipFrameUpdate = true;
      }
    } else if (isPlaying) {
      // Normal playback - use normalized timing for uniform playback
      shouldApplyAnimation = true;
      // Clear pause flag when playing
      delete (window as any).__viewer3dIsPaused;
      // Clear manual joint changes flag when playing - allow animation to take control
      hasManualJointChangesRef.current = false;
      delete (window as any).__viewer3dHasManualJointChanges;
      
      // Check if we need to reset animation start time (when starting from last frame)
      const shouldResetStartTime = (window as any).__viewer3dResetAnimationStartTime;
      if (shouldResetStartTime) {
        animationStartTime.current = 0;
        delete (window as any).__viewer3dResetAnimationStartTime;
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
          (window as any).__viewer3dCurrentFrameIndex = lastFrameIndex;
          currentFrameIndexRef.current = lastFrameIndex;
          // Store the last frame time so we stay at this position
          manualFrameTimeRef.current = normalizedLastTimestamp;
          // Set pause flag to prevent interpolation
          (window as any).__viewer3dIsPaused = true;
          // Update frame callback immediately to reflect last frame
          if (onFrameChange) {
            onFrameChange(lastFrameIndex);
          }
          // Stop playback using the window-based handler (will preserve last frame position)
          // Use requestAnimationFrame to ensure this happens after current frame is applied
          requestAnimationFrame(() => {
            (window as any).viewer3dStopAnimation?.();
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
      const currentFrameIdx = (window as any).__viewer3dCurrentFrameIndex;
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
        (window as any).__viewer3dCurrentFrameIndex = 0;
        shouldApplyAnimation = true;
      }
      // Set pause flag
      (window as any).__viewer3dIsPaused = true;
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
    (window as any).__viewer3dCurrentFrameIndex = frameIndex;
    
    // Skip frame update if we just preserved the frame position (to prevent flicker)
    const skipUpdate = (window as any).__viewer3dSkipFrameUpdate;
    if (skipUpdate) {
      delete (window as any).__viewer3dSkipFrameUpdate;
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
    const isPaused = !isPlaying && (window as any).__viewer3dIsPaused;
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
    if ((window as any).__viewer3dHasManualJointChanges) {
      hasManualJointChangesRef.current = true;
      // Clear the window property after reading it
      delete (window as any).__viewer3dHasManualJointChanges;
    }
    
    // When paused and manual changes have been made, don't apply animation values
    // This allows manual control to work after stopping playback
    if (isPaused && hasManualJointChangesRef.current) {
      return;
    }

    // Apply joint values to robot
    if (robotRef.current && robotRef.current.setJointValues) {
      robotRef.current.setJointValues(interpolatedJoints);
    } else if (robotRef.current && robotRef.current.setJointValue) {
      // Fallback to individual joint setting
      for (const jointName in interpolatedJoints) {
        robotRef.current.setJointValue(
          jointName,
          interpolatedJoints[jointName]
        );
      }
    }
    
    // Update the store in batch so UI reflects the animation
    setStoreJointValues(interpolatedJoints);
    
    // Also call onJointChange for each joint to notify parent
    if (onJointChange) {
      for (const [jointName, value] of Object.entries(interpolatedJoints)) {
        onJointChange(jointName, value);
      }
    }
  });

  // Note: We intentionally don't reset animationStartTime when stopping playback
  // This allows us to resume from where we left off
  // The animation loop will handle preserving the current position

  // ===== Selection & Highlight Helpers =====
  const highlightedMeshesRef = useRef<THREE.Mesh[]>([]);

  const clearHighlights = () => {
    highlightedMeshesRef.current.forEach((mesh) => {
      const mat = mesh.material as any;
      if (mat && mat.emissive !== undefined) {
        mat.emissive.setHex(0x000000);
        // Note: We keep the cloned material to avoid issues with material sharing
        // The material clone is already in place, just reset emissive
      }
    });
    highlightedMeshesRef.current = [];
  };

  const highlightLink = (linkName: string, jointName?: string | null) => {
    clearHighlights();
    const robot: any = robotRef.current;
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
      if ((obj as any).isMesh) {
        const mat = (obj as any).material;
        if (mat && mat.emissive !== undefined) {
          // Clone material if it hasn't been cloned yet to avoid affecting other meshes
          if (!mat.userData.isHighlighted) {
            const clonedMat = mat.clone();
            (obj as any).material = clonedMat;
            clonedMat.userData.isHighlighted = true;
            clonedMat.userData.originalMesh = obj;
          }
          (obj as any).material.emissive.setHex(highlightColor);
          highlightedMeshesRef.current.push(obj as THREE.Mesh);
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
  };

  const getLinkNameForJoint = (jointName: string): string | null => {
    const robot: any = robotRef.current;
    if (!robot) return null;
    const joint: any = robot.joints?.[jointName];
    if (!joint) return null;
    const linkNames = new Set(Object.keys(robot.links || {}));
    for (const child of joint.children || []) {
      if (linkNames.has((child as any).name)) return (child as any).name;
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
    const robot: any = robotRef.current;
    if (!robot) return;
    if (selectedJoint) {
      const ln = getLinkNameForJoint(selectedJoint);
      if (ln) highlightLink(ln, selectedJoint);
    } else {
      clearHighlights();
    }
  }, [selectedJoint, jointLimits]);

  // Document-level pointer event handlers for dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleDocumentPointerMove = (e: PointerEvent) => {
      const jointName = draggingJointRef.current;
      if (!jointName || !robotRef.current) return;
      const dragStart = dragStartRef.current;
      if (!dragStart) return;
      
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const robot: any = robotRef.current;
      const joint: any = robot.joints?.[jointName];
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
      let next = dragStart.angle + (dy * sensitivity);
      
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

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    const robot: any = robotRef.current;
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
      for (const [jName, jObj] of Object.entries<any>(robot.joints || {})) {
        if ((jObj.children || []).some((c: any) => c.name === linkName)) {
          jointName = jName;
          break;
        }
      }
      highlightLink(linkName, jointName);
    }
    onSelectPart?.({ linkName, jointName });

    // Start joint drag if joint found
    if (jointName) {
      const joint: any = robot.joints?.[jointName];
      if (joint) {
        // Get joint limits from parsed URDF data
        const limits = getJointLimits(jointLimits, jointName);
        
        // Read current angle directly from joint
        const currentAngle = typeof joint.angle === "number" ? joint.angle : 0;
        
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
  robot: any;
  jointName: string;
  axis: [number, number, number];
  jointLimits?: JointLimits;
  gpuMode?: GPUMode;
}) => {
  const planeRef = useRef<THREE.Mesh>(null);
  const [position, setPosition] = useState<THREE.Vector3>(new THREE.Vector3());
  const [rotation, setRotation] = useState<THREE.Euler>(new THREE.Euler());

  // Calculate axis vector and color reactively when axis changes
  const axisVec = useMemo(() => {
    return new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  }, [axis[0], axis[1], axis[2]]);
  
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

    const joint: any = robot.joints?.[jointName];
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

const PlaceholderLamp = ({ gpuMode = "high" }: { gpuMode?: GPUMode }) => {
  const isLowGPU = gpuMode === "low";
  const baseSegments = isLowGPU ? 16 : 32;
  const standSegments = isLowGPU ? 8 : 16;
  const shadeSegments = isLowGPU ? 16 : 32;
  const Material = isLowGPU ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
  
  return (
    <group>
      {/* Base */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.1, baseSegments]} />
        <Material color="#666666" />
      </mesh>

      {/* Stand */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.6, standSegments]} />
        <Material color="#888888" />
      </mesh>

      {/* Lampshade */}
      <mesh position={[0, 0.8, 0]} rotation={[0, 0, 0]}>
        <coneGeometry args={[0.25, 0.3, shadeSegments]} />
        <Material color="#aaaaaa" />
      </mesh>
    </group>
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
  jointValues = {},
  jointLimits = {},
  jointAxes = {},
  onJointSelect,
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
}: Viewer3DProps) => {
  // Use GPU mode hook for rendering
  const { gpuMode } = useGPUMode();
  const [motionDataFile, setMotionDataFile] = useState<File | null>(null);
  const [animationFrames, setAnimationFrames] = useState<
    AnimationFrame[] | null
  >(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const [meshFiles, setMeshFiles] = useState<MeshFiles>(initialMeshFiles);
  const [isDraggingJoint, setIsDraggingJoint] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0); // 1.0 = normal speed
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const isShiftPressedRef = useRef<boolean>(false);
  const sceneRef = useRef<THREE.Scene | null>(null);
  
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
      const threeControls = controls as any;
      
      // Set default mouse button configuration (Blender-style)
      // LEFT: rotate, MIDDLE: zoom (default), RIGHT: pan
      if (threeControls && threeControls.mouseButtons) {
        // Default: MMB zooms (DOLLY) if not already set
        if (threeControls.mouseButtons._originalMiddle === undefined) {
          threeControls.mouseButtons._originalMiddle = threeControls.mouseButtons.MIDDLE ?? THREE.MOUSE.DOLLY;
          threeControls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
        }
      }
    }, 100); // Small delay to ensure controls are initialized

    return () => clearTimeout(timeoutId);
  }, [robot]); // Re-run when robot loads

  // Handle Shift + MMB panning (Blender-style)
  useEffect(() => {
    const updateMMBBehavior = (shouldPan: boolean) => {
      if (!controlsRef.current) return;
      
      const threeControls = controlsRef.current as any;
      if (threeControls && threeControls.mouseButtons) {
        // Store original MMB behavior if not already stored
        if (threeControls.mouseButtons._originalMiddle === undefined) {
          threeControls.mouseButtons._originalMiddle = threeControls.mouseButtons.MIDDLE ?? THREE.MOUSE.DOLLY;
        }
        
        // Set MMB behavior based on Shift state
        if (shouldPan) {
          threeControls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
        } else {
          const originalMiddle = threeControls.mouseButtons._originalMiddle ?? THREE.MOUSE.DOLLY;
          threeControls.mouseButtons.MIDDLE = originalMiddle;
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

  // Global joint store
  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const setAvailableJointsStore = useJointStore((s) => s.setAvailableJoints);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  
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
    const robotAny: any = robot as any;
    
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
    const allJoints = Object.keys((robot as any).joints || {});
    // Include all joints (including fixed) but exclude non-joint items like "imu_site_frame"
    // Fixed joints need to be visible so users can change their type back
    const joints = allJoints.filter((j) => {
      const jointObj: any = (robot as any).joints?.[j];
      // Include all joint types (including fixed), but exclude sensor frames
      return jointObj && 
             (typeof jointObj.angle === "number" || jointObj.type === 'fixed') &&
             !j.toLowerCase().includes('imu') &&
             !j.toLowerCase().includes('site') &&
             !j.toLowerCase().includes('frame');
    });
    const angles: Record<string, number> = {};
    joints.forEach((j) => {
      const jointObj: any = (robot as any).joints?.[j];
      // Fixed joints always have angle 0, other joints use their actual angle
      if (jointObj.type === 'fixed') {
        angles[j] = 0;
      } else {
        angles[j] = typeof jointObj?.angle === "number" ? jointObj.angle : 0;
      }
    });
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

    const box = new THREE.Box3().setFromObject(robot as any);
    onRobotBoundingBoxChange?.(box);
    onRobotLoaded?.(robot);
  }, [robot, onRobotBoundingBoxChange, onRobotLoaded]);

  // Apply joint values from props (skip if dragging)
  useEffect(() => {
    if (!robot || isDraggingJoint) return;
    const r: any = robot as any;
    if (typeof r.setJointValue !== "function") return;
    for (const [jointName, value] of Object.entries(jointValues)) {
      if (typeof value === "number" && !Number.isNaN(value)) {
        r.setJointValue(jointName, value);
      }
    }
  }, [robot, jointValues, isDraggingJoint]);

  // Apply joint values from global store (authoritative for live slider moves, skip if dragging)
  useEffect(() => {
    if (!robot || isDraggingJoint) return;
    const r: any = robot as any;
    if (typeof r.setJointValue !== "function") return;
    let hasChanges = false;
    for (const [jointName, value] of Object.entries(storeJointValues)) {
      if (typeof value === "number" && !Number.isNaN(value)) {
        // Check if the value differs from current robot joint value
        const currentValue = r.joints?.[jointName]?.jointValue ?? r.getJointValue?.(jointName);
        if (currentValue !== undefined && Math.abs(currentValue - value) > 0.001) {
          hasChanges = true;
        }
        r.setJointValue(jointName, value);
      }
    }
    // Mark manual changes if we're not playing and values actually changed
    // This allows slider changes to also prevent animation from overwriting manual changes
    if (hasChanges && !isPlaying) {
      // Use window property to communicate with URDFModel's animation loop
      (window as any).__viewer3dHasManualJointChanges = true;
    }
  }, [robot, storeJointValues, isDraggingJoint, isPlaying]);

  const handleMotionDataUpload = (e: React.ChangeEvent<HTMLInputElement> | File) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (file) {
      setMotionDataFile(file);
      parseMotionDataFile(file);
      onMotionFileChange?.(file);
      toast.success(`Motion data file uploaded: ${file.name}`);
    }
  };

  const parseMotionDataFile = (file: File) => {
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

      const robotAny: any = robot as any;
      const robotJointKeys: string[] = robotAny
        ? Object.keys(robotAny.joints || {})
        : [];
      const actuatedJoints: string[] = robotJointKeys
        .filter((key) => {
          const joint = robotAny?.joints?.[key];
          return joint && typeof joint.angle === "number";
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

      columns.forEach((columnName) => {
        if (actuatedSet.has(columnName)) {
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
            (actuatedSet.has(sourceJoint) ? sourceJoint : undefined);
          if (targetJoint !== undefined) {
            mapped[targetJoint] = value;
          }
        }
        return { timestamp: frame.timestamp, joints: mapped };
      });

      if (
        frames.length === 0 ||
        frames.every((frame) => Object.keys(frame.joints).length === 0)
      ) {
        toast.error("No data rows found");
        return;
      }

      setIsPlaying(false);
      setAnimationFrames(frames);

      if (robot && frames.length > 0) {
        const firstFrame = frames[0].joints;
        const robotAnyInstance = robot as any;
        if (robotAnyInstance.setJointValues) {
          robotAnyInstance.setJointValues(firstFrame);
        } else if (robotAnyInstance.setJointValue) {
          for (const [jointName, value] of Object.entries(firstFrame)) {
            robotAnyInstance.setJointValue(jointName, value);
          }
        }
        setStoreJointValues(firstFrame);
      }

      const jointNames = Object.keys(frames[0]?.joints || {});

      toast.success(
        `Loaded ${frames.length} frames with ${jointNames.length} joints`
      );
    };

    reader.readAsText(file);
  };

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
      const currentFrameIdx = (window as any).__viewer3dCurrentFrameIndex;
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
        (window as any).__viewer3dManualFrameTime = normalizedFirstTime;
        (window as any).__viewer3dCurrentFrameIndex = 0;
        (window as any).__viewer3dResetAnimationStartTime = true; // Flag to reset animation start time
        // Clear any preserved frame time that might keep us at the last frame
        delete (window as any).__viewer3dPreserveFrameTime;
        
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
      delete (window as any).__viewer3dIsPaused;
      // Clear manual joint changes flag when starting to play - allow animation to take control
      // Use window property since URDFModel manages the actual ref
      delete (window as any).__viewer3dHasManualJointChanges;
    } else {
      // Set pause flag when pausing
      (window as any).__viewer3dIsPaused = true;
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
      delete (window as any).__viewer3dIsPaused;
      // Clear manual joint changes flag when starting to play - allow animation to take control
      // Note: hasManualJointChangesRef is in URDFModel, so we use window property
      delete (window as any).__viewer3dHasManualJointChanges;
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
      const currentFrameIdx = (window as any).__viewer3dCurrentFrameIndex ?? 0;
      
      // Calculate normalized time for current frame
      const normalizedTime = firstTimestamp + currentFrameIdx * normalizedFrameDuration;
      
      // Store it immediately so the animation loop can use it right away
      (window as any).__viewer3dPreserveFrameTime = normalizedTime;
      
      // Also immediately update the frame callback to prevent UI from showing wrong frame
      if (onFrameChange && currentFrameIdx >= 0) {
        onFrameChange(currentFrameIdx);
      }
    }
    
    setIsPlaying(false);
    onPlayingChange?.(false);
    // Set pause flag to prevent interpolation when stopped
    (window as any).__viewer3dIsPaused = true;
  }, [onPlayingChange, animationFrames, onFrameChange]);

  // Handler to clear animation frames and release robot for manual control
  const handleClearAnimation = useCallback(() => {
    setIsPlaying(false);
    onPlayingChange?.(false);
    setAnimationFrames(null);
    // Clear all animation-related flags
    (window as any).__viewer3dIsPaused = true;
    delete (window as any).__viewer3dPreserveFrameTime;
    delete (window as any).__viewer3dManualFrameTime;
    delete (window as any).__viewer3dCurrentFrameIndex;
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
    (window as any).__viewer3dIsPaused = true;
    
    // Clamp frame index to valid range
    const clampedIndex = Math.max(0, Math.min(frameIndex, animationFrames.length - 1));
    const targetFrame = animationFrames[clampedIndex];
    
    // Set manual frame time to jump to this frame
    if (targetFrame) {
      (window as any).__viewer3dManualFrameTime = targetFrame.timestamp;
      
      // Immediately update frame index to prevent it from going to frame 1
      (window as any).__viewer3dCurrentFrameIndex = clampedIndex;
      
      // Update frame change callback immediately
      if (onFrameChange) {
        onFrameChange(clampedIndex);
      }
    }
  }, [animationFrames, onPlayingChange, onFrameChange]);

  // Expose handlers for external use (e.g., from Sidebar)
  useEffect(() => {
    (window as any).viewer3dPlayAnimation = handleRun;
    (window as any).viewer3dUploadMotionData = handleMotionDataUpload;
    (window as any).viewer3dPlayEpisode = handlePlayEpisode;
    (window as any).viewer3dStopAnimation = handleStopAnimation;
    (window as any).viewer3dClearAnimation = handleClearAnimation;
    (window as any).viewer3dSetFrame = handleSetFrame;
    (window as any).viewer3dSetPlaybackSpeed = setPlaybackSpeed;
    (window as any).viewer3dGetPlaybackSpeed = () => playbackSpeed;
    return () => {
      delete (window as any).viewer3dPlayAnimation;
      delete (window as any).viewer3dUploadMotionData;
      delete (window as any).viewer3dPlayEpisode;
      delete (window as any).viewer3dStopAnimation;
      delete (window as any).viewer3dClearAnimation;
      delete (window as any).viewer3dSetFrame;
      delete (window as any).viewer3dSetPlaybackSpeed;
      delete (window as any).viewer3dGetPlaybackSpeed;
      delete (window as any).__viewer3dManualFrameTime;
    };
  }, [handleRun, handleMotionDataUpload, handlePlayEpisode, handleStopAnimation, handleClearAnimation, handleSetFrame, playbackSpeed]);

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
    const robotAny: any = robot;
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
    // In Z-up coordinate system (URDF standard):
    // X = right, Y = forward, Z = up
    switch (direction) {
      case 'front': // Looking from +Y direction
        cameraPosition = new THREE.Vector3(center.x, center.y + distance, center.z);
        break;
      case 'back': // Looking from -Y direction
        cameraPosition = new THREE.Vector3(center.x, center.y - distance, center.z);
        break;
      case 'right': // Looking from +X direction
        cameraPosition = new THREE.Vector3(center.x + distance, center.y, center.z);
        break;
      case 'left': // Looking from -X direction
        cameraPosition = new THREE.Vector3(center.x - distance, center.y, center.z);
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
    const robotAny: any = robot;

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
    const robotAny: any = robot;
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
        {/* Joint Types Panel with Selected Joint - Blender Style */}
        {Object.keys(jointLimits || {}).length > 0 && (() => {
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

          // Helper to convert hex to rgba
          const hexToRgba = (hex: string, alpha: number) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          };

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

                {/* Selected Joint Section - Compact (Second) */}
                <div className="pt-1.5 border-t border-border/15">
                  <div className="text-[9px] font-semibold text-muted-foreground/80 tracking-tight mb-0.5 uppercase">
                    Selected Joint
                  </div>
                  <div className="text-[11px] text-foreground font-medium truncate">
                    {selectedJoint || "None"}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

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
            // Use Z-up like Plotly/URDF
            scene.up.set(0, 0, 1);
            camera.up.set(0, 0, 1);
            cameraRef.current = camera as THREE.PerspectiveCamera;
            sceneRef.current = scene;
            // Expose camera to window for object dragging
            (window as any).__viewer3dCamera = camera;
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

          {urdfFile ? (
            <>
              <URDFModel
                file={urdfFile}
                meshFiles={meshFiles}
                animationFrames={animationFrames}
                isPlaying={isPlaying}
                onRobotLoaded={setRobot}
                selectedJoint={selectedJoint}
                jointLimits={jointLimits}
                jointAxes={jointAxes}
                gpuMode={gpuMode}
                playbackSpeed={playbackSpeed}
                rotationPlaneVisible={rotationPlaneVisible}
                onSelectPart={({ jointName }) =>
                  onJointSelect?.(jointName ?? null)
                }
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
              <CreatedObjects robot={robot} gpuMode={gpuMode} />
            </>
          ) : (
            <PlaceholderLamp gpuMode={gpuMode} />
          )}

          {/* Custom axes helper - solid lines for positive, dots for negative */}
          <CustomAxesHelper size={10} />
          
          {/* Blender-style 3D axis gizmo */}
          <AxisGizmo3D onViewChange={setView} />
          
          {/* Camera icons visualization */}
          {robot && <CameraIcons robot={robot} gpuMode={gpuMode} />}
          
          {/* Camera view buttons */}
          {robot && (
            <CameraViewButtons
              robot={robot}
              onCameraViewChange={handleCameraViewChange}
            />
          )}
          
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enabled={!isDraggingJoint}
            enablePan={true}
            enableRotate={true}
            enableZoom={true}
            enableDamping={false}
            panSpeed={1.0}
            rotateSpeed={1.0}
            zoomSpeed={1.0}
          />
        </Canvas>

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
