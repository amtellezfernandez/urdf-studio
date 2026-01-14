import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import type { URDFRobot } from "urdf-loader";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import type { MeshFiles } from "@/shared/types/feature";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";

export const CollisionGeometries = ({
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
  const collisionMeshesRef = useRef<
    Map<
      string,
      {
        mesh: THREE.Mesh;
        linkName: string;
        localMatrix: THREE.Matrix4;
      }
    >
  >(new Map());
  const tempMatrix = useRef(new THREE.Matrix4());
  const tempPosition = useRef(new THREE.Vector3());
  const tempQuaternion = useRef(new THREE.Quaternion());
  const tempScale = useRef(new THREE.Vector3());

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
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose());
      } else {
        material.dispose();
      }
      mesh.geometry?.dispose();
      collisionGroupRef.current?.remove(mesh);
    });
    collisionMeshesRef.current.clear();

    while (collisionGroupRef.current.children.length > 0) {
      const child = collisionGroupRef.current.children[0];
      if (child instanceof THREE.Mesh && child.userData?.isCollisionGeometry) {
        const material = child.material;
        if (Array.isArray(material)) {
          material.forEach((mat) => mat.dispose());
        } else {
          material.dispose();
        }
        child.geometry?.dispose();
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
      const robotObject = robot;
      robotObject?.updateMatrixWorld(true);

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
      const applyLinkTransform = (
        mesh: THREE.Mesh,
        linkName: string,
        localMatrix: THREE.Matrix4
      ) => {
        // Get the link object from robot
        const linkObject =
          robotObject.links?.[linkName] ?? robotObject.getObjectByName?.(linkName);

        if (linkObject) {
          const linkWorldMatrix = new THREE.Matrix4().copy(linkObject.matrixWorld);

          // Combine: world = linkWorld * local
          linkWorldMatrix.multiply(localMatrix);

          // Extract position and rotation from combined matrix
          const worldPosition = new THREE.Vector3();
          const worldQuaternion = new THREE.Quaternion();
          const worldScale = new THREE.Vector3();
          linkWorldMatrix.decompose(worldPosition, worldQuaternion, worldScale);

          mesh.position.copy(worldPosition);
          mesh.quaternion.copy(worldQuaternion);
        } else {
          // Fallback: just use local transform if link not found
          localMatrix.decompose(
            tempPosition.current,
            tempQuaternion.current,
            tempScale.current
          );
          mesh.position.copy(tempPosition.current);
          mesh.quaternion.copy(tempQuaternion.current);
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
          const xyz = (origin?.getAttribute("xyz")?.split(" ").map(parseFloat) || [
            0,
            0,
            0,
          ]) as [number, number, number];
          const rpy = (origin?.getAttribute("rpy")?.split(" ").map(parseFloat) || [
            0,
            0,
            0,
          ]) as [number, number, number];

          const localMatrix = new THREE.Matrix4();
          localMatrix.makeRotationFromEuler(
            new THREE.Euler(rpy[0], rpy[1], rpy[2], "XYZ")
          );
          localMatrix.setPosition(xyz[0], xyz[1], xyz[2]);

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
            // No scaling - use mesh geometry as-is

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
                    // No geometry scaling applied
                    const loadedMesh = new THREE.Mesh(geometry, collisionMaterial.clone());
                    loadedMesh.renderOrder = 999;
                    applyLinkTransform(loadedMesh, linkName, localMatrix);
                    loadedMesh.userData.isCollisionGeometry = true;
                    loadedMesh.userData.linkName = linkName;
                    collisionGroupRef.current?.add(loadedMesh);
                    // Store reference for frame updates
                    const meshKey = `${linkName}_${index}`;
                    collisionMeshesRef.current.set(meshKey, {
                      mesh: loadedMesh,
                      linkName,
                      localMatrix,
                    });
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
            applyLinkTransform(mesh, linkName, localMatrix);
            mesh.userData.isCollisionGeometry = true;
            mesh.userData.linkName = linkName;
            collisionGroupRef.current.add(mesh);
            // Store reference for frame updates
            const meshKey = `${linkName}_${index}`;
            collisionMeshesRef.current.set(meshKey, {
              mesh,
              linkName,
              localMatrix,
            });
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

    const robotObject = robot;
    robotObject.updateMatrixWorld?.(true);

    // Update each collision mesh transform based on its link's current world position
    collisionMeshesRef.current.forEach(({ mesh, linkName, localMatrix }) => {
      const linkObject =
        robotObject.links?.[linkName] ?? robotObject.getObjectByName?.(linkName);

      if (linkObject) {
        tempMatrix.current.copy(linkObject.matrixWorld).multiply(localMatrix);
        tempMatrix.current.decompose(
          tempPosition.current,
          tempQuaternion.current,
          tempScale.current
        );
        mesh.position.copy(tempPosition.current);
        mesh.quaternion.copy(tempQuaternion.current);
      }
    });
  });

  return <group ref={collisionGroupRef} renderOrder={999} />;
};
