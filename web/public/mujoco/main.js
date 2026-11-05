import * as THREE from "three";

import {
  loadSceneFromURL,
  getPosition,
  getQuaternion,
  toMujocoPos,
  standardNormal,
  stageMjcfSceneToVfs,
  removeAllMujocoRoots,
} from "./mujocoUtils.js";
import { DragStateManager } from "./utils/DragStateManager.js";
import { JointDragManager } from "./utils/JointDragManager.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import load_mujoco from "./wasm/mujoco_wasm.js";

// Load the MuJoCo Module
const mujoco = await load_mujoco();

// Set up Emscripten's Virtual File System (no prefetch)
mujoco.FS.mkdir("/working");
mujoco.FS.mount(mujoco.MEMFS, { root: "." }, "/working");

export class Mujoco {
  constructor() {
    this.mujoco = mujoco;
    this.model = null;
    this.state = null;
    this.simulation = null;

    // Define parameters
    this.params = {
      scene: null,
      paused: true,
      help: false,
      ctrlnoiserate: 0.0,
      ctrlnoisestd: 0.0,
      keyframeNumber: 0,
    };
    this.mujoco_time = 0.0;
    this.bodies = {};
    this.lights = [];
    this.tmpVec = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();

    this.container = document.createElement("div");
    document.body.appendChild(this.container);

    this.scene = new THREE.Scene();
    this.scene.name = "scene";

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.001,
      100
    );
    this.camera.name = "PerspectiveCamera";
    this.camera.position.set(2.0, 1.7, 1.7);
    this.scene.add(this.camera);

    // Theme defaults; can be overridden by parent messages
    this.theme = {
      sceneBg: "#fef4da",
      floor: "#fcf4dc",
      ambient: "#fcf4dc",
      hemi: "#fcf4dc",
    };
    this.scene.background = new THREE.Color(this.theme.sceneBg);

    // Centralized fill lights based on default theme
    this._createFillLights();

    // TODO: Might need high-performence powerPreference
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "default",
    });

    // Cap device pixel ratio for performance on high-DPI displays
    const MAX_PIXEL_RATIO = 1.5;
    this.renderer.setPixelRatio(
      Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio)
    );

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setAnimationLoop(this.render.bind(this));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.7, 0);
    this.controls.panSpeed = 2;
    this.controls.zoomSpeed = 1;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;
    this.controls.update();

    window.addEventListener("resize", this.onWindowResize.bind(this));

    this.dragStateManager = new DragStateManager(
      this.scene,
      this.renderer,
      this.camera,
      this.container.parentElement,
      this.controls
    );

    // Joint drag manager for manipulating joints when simulation is paused
    this.jointDragManager = new JointDragManager(
      this.scene,
      this.renderer,
      this.camera,
      this.container.parentElement,
      this.controls,
      null // Will be set when simulation is loaded
    );

    // Initially enable joint drag manager (starts paused) and disable physics drag
    this.jointDragManager.enable();
    this.dragStateManager.disable();

    // Add hover highlighting functionality
    this.hoverRaycaster = new THREE.Raycaster();
    this.hoveredBody = null;
    this.mousePos = new THREE.Vector2();
    this.originalMaterials = new Map(); // Store original materials for restoration
    this.highlightColor = new THREE.Color(0xfbe651); // Yellow highlight color similar to URDF viewer

    // Add mouse move event listener for hover detection
    this.renderer.domElement.addEventListener(
      "mousemove",
      this.onMouseMove.bind(this)
    );
    this.renderer.domElement.addEventListener(
      "mouseleave",
      this.onMouseLeave.bind(this)
    );
  }

  _createFillLights() {
    if (this.ambientLight) this.scene.remove(this.ambientLight);
    if (this.hemiLight) this.scene.remove(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(
      new THREE.Color(this.theme.ambient),
      0.2
    );
    this.ambientLight.name = "AmbientLight";
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(
      new THREE.Color(this.theme.hemi),
      new THREE.Color(this.theme.hemi),
      0.1
    );
    this.hemiLight.position.set(0, 1, 0);
    this.hemiLight.name = "HemisphereLight";
    this.scene.add(this.hemiLight);
  }

  onMouseMove(event) {
    // Update mouse position for raycasting
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mousePos.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mousePos.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    this.hoverRaycaster.setFromCamera(this.mousePos, this.camera);

    // Check for intersections with scene objects
    const intersects = this.hoverRaycaster.intersectObjects(
      this.scene.children,
      true
    );

    let newHoveredBody = null;

    // Find the first intersected object that has a bodyID
    for (let i = 0; i < intersects.length; i++) {
      let obj = intersects[i].object;

      // If the object has a bodyID, find the corresponding body group
      if (obj.bodyID !== undefined && obj.bodyID > 0) {
        // Find the body group in this.bodies
        const bodyGroup = this.bodies[obj.bodyID];
        if (bodyGroup && bodyGroup.name) {
          newHoveredBody = bodyGroup;
          break;
        }
      }
    }

    // Check if hover state changed
    if (newHoveredBody !== this.hoveredBody) {
      // Remove highlighting from previously hovered body
      if (this.hoveredBody) {
        this.removeBodyHighlight(this.hoveredBody);
        window.parent.postMessage(
          {
            type: "BODY_MOUSEOUT",
            bodyName: this.hoveredBody.name,
          },
          "*"
        );
      }

      // Update hovered body
      this.hoveredBody = newHoveredBody;

      // Apply highlighting to newly hovered body
      if (this.hoveredBody) {
        this.applyBodyHighlight(this.hoveredBody);
        window.parent.postMessage(
          {
            type: "BODY_MOUSEOVER",
            bodyName: this.hoveredBody.name,
          },
          "*"
        );
      }
    }
  }

  applyBodyHighlight(bodyGroup) {
    // Traverse all children (meshes) in the body group and apply highlighting
    bodyGroup.traverse((child) => {
      if (child.isMesh && child.material) {
        // Store original material properties if not already stored
        if (!this.originalMaterials.has(child.uuid)) {
          this.originalMaterials.set(child.uuid, {
            emissive: child.material.emissive.clone(),
            emissiveIntensity: child.material.emissiveIntensity || 0,
          });
        }

        // Apply highlight
        child.material.emissive.copy(this.highlightColor);
        child.material.emissiveIntensity = 0.3;
      }
    });
  }

  removeBodyHighlight(bodyGroup) {
    // Traverse all children (meshes) in the body group and remove highlighting
    bodyGroup.traverse((child) => {
      if (
        child.isMesh &&
        child.material &&
        this.originalMaterials.has(child.uuid)
      ) {
        // Restore original material properties
        const original = this.originalMaterials.get(child.uuid);
        child.material.emissive.copy(original.emissive);
        child.material.emissiveIntensity = original.emissiveIntensity;

        // Clean up stored material
        this.originalMaterials.delete(child.uuid);
      }
    });
  }

  onMouseLeave() {
    // Clear hover state when mouse leaves the canvas
    if (this.hoveredBody) {
      this.removeBodyHighlight(this.hoveredBody);
      window.parent.postMessage(
        {
          type: "BODY_MOUSEOUT",
          bodyName: this.hoveredBody.name,
        },
        "*"
      );
      this.hoveredBody = null;
    }
  }

  updateDragMode() {
    // Switch between joint drag manager (when paused) and physics drag manager (when simulating)
    if (this.params["paused"]) {
      this.dragStateManager.disable();
      this.jointDragManager.enable();
    } else {
      this.jointDragManager.disable();
      this.dragStateManager.enable();
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const MAX_PIXEL_RATIO = 1.5;
    this.renderer.setPixelRatio(
      Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio)
    );
  }

  render(timeMS) {
    if (!this.model || !this.simulation) {
      // Nothing loaded yet; still render background/empty scene
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.controls.update();

    if (!this.params["paused"]) {
      // If not paused, simulate the physics
      let timestep = this.model.getOptions().timestep;
      if (timeMS - this.mujoco_time > 35.0) {
        this.mujoco_time = timeMS;
      }
      while (this.mujoco_time < timeMS) {
        if (this.params["ctrlnoisestd"] > 0.0) {
          let rate = Math.exp(
            -timestep / Math.max(1e-10, this.params["ctrlnoiserate"])
          );
          let scale = this.params["ctrlnoisestd"] * Math.sqrt(1 - rate * rate);
          let currentCtrl = this.simulation.ctrl;
          for (let i = 0; i < currentCtrl.length; i++) {
            currentCtrl[i] = rate * currentCtrl[i] + scale * standardNormal();
            this.params["Actuator " + i] = currentCtrl[i];
          }
        }

        for (let i = 0; i < this.simulation.qfrc_applied.length; i++) {
          this.simulation.qfrc_applied[i] = 0.0;
        }
        let dragged = this.dragStateManager.physicsObject;
        if (dragged && dragged.bodyID) {
          for (let b = 0; b < this.model.nbody; b++) {
            if (this.bodies[b]) {
              getPosition(this.simulation.xpos, b, this.bodies[b].position);
              getQuaternion(
                this.simulation.xquat,
                b,
                this.bodies[b].quaternion
              );
              this.bodies[b].updateWorldMatrix();
            }
          }
          let bodyID = dragged.bodyID;
          this.dragStateManager.update();
          let force = toMujocoPos(
            this.dragStateManager.currentWorld
              .clone()
              .sub(this.dragStateManager.worldHit)
              .multiplyScalar(this.model.body_mass[bodyID] * 250)
          );
          let point = toMujocoPos(this.dragStateManager.worldHit.clone());
          this.simulation.applyForce(
            force.x,
            force.y,
            force.z,
            0,
            0,
            0,
            point.x,
            point.y,
            point.z,
            bodyID
          );
        }

        this.simulation.step();
        this.mujoco_time += timestep * 1000.0;
      }
    } else if (this.params["paused"]) {
      // If paused, the joint drag manager handles manipulation and calls simulation.forward() when needed
      // Only call forward if no joint manipulation is happening
      if (!this.jointDragManager.active) {
        this.simulation.forward();
      }
    }

    // Update body transforms from current simulation state
    for (let b = 0; b < this.model.nbody; b++) {
      if (this.bodies[b]) {
        getPosition(this.simulation.xpos, b, this.bodies[b].position);
        getQuaternion(this.simulation.xquat, b, this.bodies[b].quaternion);
        this.bodies[b].updateWorldMatrix();
      }
    }

    // Update light transforms.
    for (let l = 0; l < this.model.nlight; l++) {
      if (this.lights[l]) {
        getPosition(this.simulation.light_xpos, l, this.lights[l].position);
        getPosition(this.simulation.light_xdir, l, this.tmpVec);
        this.lights[l].lookAt(this.tmpVec.add(this.lights[l].position));
      }
    }

    // Render the scene
    this.renderer.render(this.scene, this.camera);
  }
}

let viewer = new Mujoco();
// Signal readiness to the parent so it can send initial scene messages safely
window.parent.postMessage({ type: "IFRAME_READY" }, "*");

// Set up message handling for parent-iframe communication
window.addEventListener("message", async (event) => {
  // Received message from parent

  try {
    switch (event.data.type) {
      case "RESET_POSE":
        if (viewer?.simulation) {
          viewer.simulation.resetData();
          viewer.simulation.forward();
        }
        break;
      case "PAUSE_SIMULATION":
        if (viewer?.params) {
          viewer.params.paused = true;
          viewer.updateDragMode();
        }
        break;
      case "RESUME_SIMULATION":
        if (viewer?.params) {
          viewer.params.paused = false;
          viewer.updateDragMode();
        }
        break;
      case "LOAD_SCENE":
        removeAllMujocoRoots(viewer);
        // Stage provided scene content (xml/files) only; no public fetching
        const normalizedRoot = await stageMjcfSceneToVfs(
          mujoco,
          event.data.root,
          {
            files: event.data.files || [],
            xml: event.data.xml || null,
          }
        );
        [
          viewer.model,
          viewer.state,
          viewer.simulation,
          viewer.bodies,
          viewer.lights,
        ] = await loadSceneFromURL(mujoco, normalizedRoot, viewer);

        // Update joint drag manager with the new model and simulation
        viewer.jointDragManager.simulation = viewer.simulation;
        viewer.jointDragManager.model = viewer.model;

        viewer.simulation.resetData();
        viewer.simulation.forward();

        // Default to paused when a scene is loaded
        if (viewer?.params) {
          viewer.params.paused = true;
          viewer.updateDragMode();
        }

        window.parent.postMessage(
          { type: "SCENE_LOADED", sceneName: normalizedRoot },
          "*"
        );
        break;
      default:
        // Unknown message type
        console.warn("Unknown message type:", event.data.type);
    }
  } catch (error) {
    // Log the full error object for better debugging of Emscripten exceptions
    console.error("❌ Error handling message:", error);

    // Notify parent of error with a stringified fallback to capture non-Error throws
    window.parent.postMessage(
      {
        type: "ERROR",
        error: String(error),
      },
      "*"
    );
  }
});
