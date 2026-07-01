import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import URDFLoader, { type URDFJoint, type URDFRobot } from "urdf-loader";

type MeshAsset = {
  path: string;
  file: File;
  url: string;
};

type JointRow = {
  name: string;
  type: URDFJoint["jointType"];
  lower: number;
  upper: number;
};

type SceneObject = {
  id: string;
  name: string;
  type: "cube" | "sphere" | "cylinder";
  position: [number, number, number];
  size: [number, number, number];
  color: string;
};

type SceneCamera = {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  fovDeg: number;
};

type WorkspaceTarget = {
  targetId: string;
  label: string;
  targetKind: string;
  transferPolicy?: {
    robotAssetFormat?: string;
    sceneAssetFormat?: string;
    transferStrategy?: string;
  };
};

type WorkspaceOpenResponse = {
  started?: boolean;
  pid?: number;
  command?: string[];
  logPath?: string | null;
  worldPackagePath?: string;
  robotUrdfPath?: string;
  targetAssetPath?: string | null;
  unresolvedMeshRefs?: string[];
};

const API_BASE_URL = __URDF_CONFIG__?.apiBaseUrl || "/api";

const DEFAULT_URDF = `<?xml version="1.0"?>
<robot name="minimal_demo">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.05" rpy="0 0 0"/>
      <geometry><box size="0.5 0.35 0.1"/></geometry>
      <material name="base"><color rgba="0.25 0.55 0.95 1"/></material>
    </visual>
  </link>
  <link name="arm_link">
    <visual>
      <origin xyz="0.45 0 0" rpy="0 1.5708 0"/>
      <geometry><cylinder radius="0.045" length="0.9"/></geometry>
      <material name="arm"><color rgba="0.95 0.72 0.25 1"/></material>
    </visual>
  </link>
  <joint name="shoulder_pan" type="revolute">
    <parent link="base_link"/>
    <child link="arm_link"/>
    <origin xyz="0 0 0.12" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-1.57" upper="1.57" effort="10" velocity="1"/>
  </joint>
</robot>`;

const RUNTIME_TARGETS = [
  { name: "genesis", mode: "python" },
  { name: "mujoco", mode: "python" },
  { name: "pybullet", mode: "python" },
  { name: "blender", mode: "python" },
] as const;

const isUrdfFile = (file: File) => /\.urdf$/i.test(file.name);
const isXacroFile = (file: File) => /\.xacro$/i.test(file.name);

const getFilePath = (file: File): string => {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath || file.name;
};

const normalizePath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/^\.?\//, "");

const basename = (path: string): string => normalizePath(path).split("/").pop() || path;

const fileToText = (file: File): Promise<string> => file.text();

const fileToBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const resolveMeshUrl = (rawPath: string, assets: readonly MeshAsset[]): string | null => {
  const normalized = normalizePath(rawPath.replace(/^package:\/\//, ""));
  const candidates = [
    normalized,
    normalized.replace(/^[^/]+\//, ""),
    basename(normalized),
  ];
  const asset = assets.find((candidate) => {
    const assetPath = normalizePath(candidate.path);
    return candidates.some(
      (path) => assetPath === path || assetPath.endsWith(`/${path}`),
    );
  });
  return asset?.url ?? null;
};

const getJointLimit = (joint: URDFJoint, fallback: number): number => {
  const value = fallback < 0 ? joint.limit?.lower : joint.limit?.upper;
  return Number.isFinite(value) ? value : fallback;
};

const toJointRows = (robot: URDFRobot): JointRow[] =>
  Object.entries(robot.joints)
    .filter(([, joint]) => joint.jointType !== "fixed")
    .map(([name, joint]) => ({
      name,
      type: joint.jointType,
      lower: getJointLimit(joint, -Math.PI),
      upper: getJointLimit(joint, Math.PI),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

const buildObjectMesh = (object: SceneObject): THREE.Object3D => {
  const material = new THREE.MeshStandardMaterial({
    color: object.color,
    roughness: 0.62,
    metalness: 0.05,
  });
  const geometry =
    object.type === "sphere"
      ? new THREE.SphereGeometry(object.size[0] / 2, 24, 16)
      : object.type === "cylinder"
        ? new THREE.CylinderGeometry(object.size[0] / 2, object.size[0] / 2, object.size[2], 24)
        : new THREE.BoxGeometry(...object.size);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...object.position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const buildCameraMarker = (camera: SceneCamera): THREE.Object3D => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: "#44d7b6" }),
  );
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.16, 4),
    new THREE.MeshStandardMaterial({ color: "#44d7b6", transparent: true, opacity: 0.45 }),
  );
  cone.rotation.x = Math.PI / 2;
  cone.position.z = -0.12;
  group.add(body, cone);
  group.position.set(...camera.position);
  group.rotation.set(...camera.rotation);
  return group;
};

const buildWorldPackage = async ({
  urdfName,
  urdfText,
  jointValues,
  objects,
  cameras,
}: {
  urdfName: string;
  urdfText: string;
  jointValues: Record<string, number>;
  objects: readonly SceneObject[];
  cameras: readonly SceneCamera[];
}) => {
  const digest = await sha256Hex(urdfText);
  return {
    schema_version: "1.0.0",
    package_id: `local-${digest.slice(0, 12)}`,
    version: "0.1.0",
    title: urdfName.replace(/\.(urdf|xacro)$/i, "") || "Local URDF workspace",
    description: "Local URDF Studio workspace prepared for simulator transfer.",
    created_at: new Date().toISOString(),
    runtime_targets: RUNTIME_TARGETS,
    interface: {
      observation_modalities: ["joint_state"],
      action_semantics: "manual_workspace_transfer",
      timestep_ms: 20,
      frame_convention: "ros-rep-103",
    },
    artifacts: [
      {
        kind: "urdf",
        digest_sha256: digest,
        uri: `asset://${normalizePath(urdfName || "robot.urdf")}`,
      },
    ],
    world_snapshot: {
      urdf_xml: urdfText,
      joint_positions: jointValues,
      cameras: cameras.map((camera) => ({
        id: camera.id,
        name: camera.name,
        parent_joint: "world",
        pose: { xyz: camera.position, rpy: camera.rotation },
        intrinsics: { width: 1280, height: 720, fov_deg: camera.fovDeg },
      })),
      objects: objects.map((object) => ({
        id: object.id,
        name: object.name,
        type: object.type,
        color: object.color,
        position_xyz: object.position,
        size_xyz: object.size,
        rotation_rpy_rad: [0, 0, 0],
        source: "user",
        simulation: {
          fixed: true,
          collision: true,
          mass_kg: 1,
          friction: 0.8,
          restitution: 0.1,
        },
      })),
      scenario_time_ms: 0,
      scenario_duration_ms: 1000,
    },
    provenance: {
      source: "local-browser",
      release_surface: "main-clean",
    },
    security: {
      signature_ref: null,
      attestation_refs: [],
      sbom_ref: null,
    },
  };
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const robotGroupRef = useRef<THREE.Group | null>(null);
  const sceneObjectsRef = useRef<THREE.Group | null>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  const [urdfName, setUrdfName] = useState("demo.urdf");
  const [urdfText, setUrdfText] = useState(DEFAULT_URDF);
  const [meshAssets, setMeshAssets] = useState<MeshAsset[]>([]);
  const [jointRows, setJointRows] = useState<JointRow[]>([]);
  const [jointValues, setJointValues] = useState<Record<string, number>>({});
  const [status, setStatus] = useState("Load a URDF file or use the built-in demo.");
  const [targets, setTargets] = useState<WorkspaceTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState("genesis");
  const [transferResult, setTransferResult] = useState<WorkspaceOpenResponse | null>(null);
  const [objects, setObjects] = useState<SceneObject[]>([
    {
      id: "box-1",
      name: "Reference box",
      type: "cube",
      position: [0.8, 0, 0.08],
      size: [0.18, 0.18, 0.18],
      color: "#f97316",
    },
  ]);
  const [cameras, setCameras] = useState<SceneCamera[]>([
    {
      id: "camera-1",
      name: "Workspace camera",
      position: [1.4, -1.2, 0.8],
      rotation: [0.65, 0, 0.8],
      fovDeg: 55,
    },
  ]);

  const movableJointCount = jointRows.length;
  const meshAssetNames = useMemo(
    () => meshAssets.map((asset) => asset.path).join(", "),
    [meshAssets],
  );

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.setClearColor("#111315");
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#111315", 4, 12);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(1.9, -2.2, 1.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0.25);
    controls.enableDamping = true;

    const ambient = new THREE.HemisphereLight("#f7fbff", "#202327", 1.8);
    scene.add(ambient);
    const key = new THREE.DirectionalLight("#ffffff", 2.4);
    key.position.set(2, -3, 4);
    key.castShadow = true;
    scene.add(key);
    const grid = new THREE.GridHelper(4, 40, "#3a414a", "#242a31");
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const robotGroup = new THREE.Group();
    const objectGroup = new THREE.Group();
    scene.add(robotGroup, objectGroup);
    robotGroupRef.current = robotGroup;
    sceneObjectsRef.current = objectGroup;

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const frame = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(frame);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      robotGroupRef.current = null;
      sceneObjectsRef.current = null;
    };
  }, []);

  const reloadRobot = useCallback(() => {
    const group = robotGroupRef.current;
    if (!group) return;
    group.clear();
    try {
      const loader = new URDFLoader();
      loader.parseCollision = false;
      loader.loadMeshCb = (path, manager, done) => {
        const url = resolveMeshUrl(path, meshAssets);
        if (!url) {
          done(new THREE.Group());
          return;
        }
        loader.defaultMeshLoader(url, manager, done);
      };
      const robot = loader.parse(urdfText);
      robot.rotation.x = -Math.PI / 2;
      robot.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      robotRef.current = robot;
      group.add(robot);
      const rows = toJointRows(robot);
      setJointRows(rows);
      setJointValues((previous) => {
        const next: Record<string, number> = {};
        rows.forEach((row) => {
          next[row.name] = previous[row.name] ?? 0;
          robot.setJointValue(row.name, next[row.name]);
        });
        return next;
      });
      setStatus(`Loaded ${robot.robotName || urdfName} with ${rows.length} movable joints.`);
    } catch (error) {
      robotRef.current = null;
      setJointRows([]);
      setStatus(error instanceof Error ? error.message : "Failed to parse URDF.");
    }
  }, [meshAssets, urdfName, urdfText]);

  useEffect(() => {
    reloadRobot();
  }, [reloadRobot]);

  useEffect(() => {
    const group = sceneObjectsRef.current;
    if (!group) return;
    group.clear();
    objects.forEach((object) => group.add(buildObjectMesh(object)));
    cameras.forEach((camera) => group.add(buildCameraMarker(camera)));
  }, [cameras, objects]);

  useEffect(() => {
    void fetch(`${API_BASE_URL}/workspace-transfer/targets`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { targets: [] }))
      .then((payload) => {
        const nextTargets = Array.isArray(payload.targets) ? payload.targets : [];
        setTargets(nextTargets);
        if (nextTargets[0]?.targetId) setSelectedTarget(nextTargets[0].targetId);
      })
      .catch(() => setTargets([]));
  }, []);

  const handleFiles = async (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    const targetFile =
      selectedFiles.find(isUrdfFile) ?? selectedFiles.find(isXacroFile);
    if (!targetFile) {
      setStatus("Select a .urdf or .xacro file.");
      return;
    }
    const assets = selectedFiles
      .filter((file) => file !== targetFile)
      .map((file) => {
        const url = URL.createObjectURL(file);
        objectUrlsRef.current.push(url);
        return { file, url, path: normalizePath(getFilePath(file)) };
      });
    let nextUrdf = await fileToText(targetFile);
    if (isXacroFile(targetFile)) {
      const payload = {
        target_path: normalizePath(getFilePath(targetFile)),
        files: await Promise.all(
          selectedFiles.map(async (file) => ({
            path: normalizePath(getFilePath(file)),
            content_base64: await fileToBase64(file),
          })),
        ),
        args: {},
        use_inorder: true,
      };
      const response = await fetch(`${API_BASE_URL}/ilu/expand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = (await response.json()) as { urdf: string };
      nextUrdf = result.urdf;
    }
    setUrdfName(normalizePath(getFilePath(targetFile)).replace(/\.xacro$/i, ".urdf"));
    setMeshAssets(assets);
    setUrdfText(nextUrdf);
    setTransferResult(null);
  };

  const updateJoint = (name: string, value: number) => {
    robotRef.current?.setJointValue(name, value);
    setJointValues((previous) => ({ ...previous, [name]: value }));
  };

  const addObject = () => {
    const id = `box-${objects.length + 1}`;
    setObjects((previous) => [
      ...previous,
      {
        id,
        name: `Box ${previous.length + 1}`,
        type: "cube",
        position: [0.5 + previous.length * 0.18, 0.25, 0.08],
        size: [0.16, 0.16, 0.16],
        color: "#f97316",
      },
    ]);
  };

  const addCamera = () => {
    const id = `camera-${cameras.length + 1}`;
    setCameras((previous) => [
      ...previous,
      {
        id,
        name: `Camera ${previous.length + 1}`,
        position: [1.3, -1.2 - previous.length * 0.2, 0.8],
        rotation: [0.65, 0, 0.8],
        fovDeg: 55,
      },
    ]);
  };

  const openInSimulator = async () => {
    setStatus(`Preparing ${selectedTarget} workspace...`);
    setTransferResult(null);
    const worldPackage = await buildWorldPackage({
      urdfName,
      urdfText,
      jointValues,
      objects,
      cameras,
    });
    const mesh_assets = await Promise.all(
      meshAssets.map(async (asset) => ({
        path: asset.path,
        aliases: [basename(asset.path)],
        content_base64: await fileToBase64(asset.file),
        mime: asset.file.type || null,
      })),
    );
    const response = await fetch(
      `${API_BASE_URL}/workspace-transfer/targets/${selectedTarget}/open`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          world_package: worldPackage,
          urdf_asset_path: normalizePath(urdfName || "robot.urdf"),
          mesh_assets,
          package_roots: {},
        }),
      },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Workspace transfer failed with ${response.status}.`);
    }
    const result = (await response.json()) as WorkspaceOpenResponse;
    setTransferResult(result);
    setStatus(result.started ? `Started ${selectedTarget}.` : `Prepared ${selectedTarget}.`);
  };

  return (
    <main className="app-shell">
      <section className="sidebar">
        <div className="brand">
          <span>URDF Studio</span>
          <strong>Clean Release</strong>
        </div>

        <label className="upload">
          <input
            type="file"
            multiple
            accept=".urdf,.xacro,.stl,.dae,.obj,.glb,.gltf,.mtl,.png,.jpg,.jpeg"
            onChange={(event) => void handleFiles(event.target.files).catch((error) => {
              setStatus(error instanceof Error ? error.message : "File load failed.");
            })}
          />
          Load URDF/Xacro and meshes
        </label>

        <div className="panel">
          <h2>Robot</h2>
          <p className="meta">{urdfName}</p>
          <dl>
            <div><dt>Movable joints</dt><dd>{movableJointCount}</dd></div>
            <div><dt>Mesh files</dt><dd>{meshAssets.length}</dd></div>
            <div><dt>Objects</dt><dd>{objects.length}</dd></div>
            <div><dt>Cameras</dt><dd>{cameras.length}</dd></div>
          </dl>
          {meshAssetNames ? <p className="small">{meshAssetNames}</p> : null}
        </div>

        <div className="panel actions">
          <h2>Scene</h2>
          <button type="button" onClick={addObject}>Add box</button>
          <button type="button" onClick={addCamera}>Add camera</button>
          <button type="button" onClick={() => setObjects([])}>Clear objects</button>
        </div>

        <div className="panel">
          <h2>Simulator transfer</h2>
          <select
            value={selectedTarget}
            onChange={(event) => setSelectedTarget(event.target.value)}
          >
            {(targets.length ? targets : RUNTIME_TARGETS).map((target) => {
              const id = "targetId" in target ? target.targetId : target.name;
              const label = "label" in target ? target.label : target.name;
              return <option key={id} value={id}>{label}</option>;
            })}
          </select>
          <button
            type="button"
            className="primary"
            onClick={() => void openInSimulator().catch((error) => {
              setStatus(error instanceof Error ? error.message : "Workspace transfer failed.");
            })}
          >
            Open workspace
          </button>
          {transferResult ? (
            <p className="small">
              {transferResult.targetAssetPath || transferResult.robotUrdfPath || "Workspace prepared."}
            </p>
          ) : null}
        </div>
      </section>

      <section className="viewer">
        <div className="viewer-bar">
          <span>{status}</span>
          <span>{objects.length} objects / {cameras.length} cameras</span>
        </div>
        <div ref={mountRef} className="canvas-host" />
      </section>

      <section className="inspector">
        <h2>Joints</h2>
        <div className="joint-list">
          {jointRows.length === 0 ? (
            <p className="small">No movable joints found.</p>
          ) : (
            jointRows.map((joint) => (
              <label key={joint.name} className="joint-row">
                <span>
                  <strong>{joint.name}</strong>
                  <em>{joint.type}</em>
                </span>
                <input
                  type="range"
                  min={joint.lower}
                  max={joint.upper}
                  step="0.001"
                  value={jointValues[joint.name] ?? 0}
                  onChange={(event) => updateJoint(joint.name, Number(event.target.value))}
                />
                <code>{(jointValues[joint.name] ?? 0).toFixed(3)} rad</code>
              </label>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
