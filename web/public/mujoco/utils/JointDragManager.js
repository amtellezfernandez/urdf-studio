import * as THREE from "three";
import { toMujocoPos, getPosition, getQuaternion } from "../mujocoUtils.js";

export class JointDragManager {
  constructor(scene, renderer, camera, container, controls, simulation) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.simulation = simulation;
    this.model = null; // Will be set when model is loaded
    this.mousePos = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.1;
    this.grabDistance = 0.0;
    this.active = false;
    this.draggedJoint = null;
    this.controls = controls;

    // Visual indicator for joint dragging
    this.jointIndicator = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.8,
      })
    );
    this.jointIndicator.visible = false;
    this.scene.add(this.jointIndicator);

    // Text indicator for joint info (styled to match overlay style)
    this.jointInfo = document.createElement("div");
    this.jointInfo.style.position = "absolute";
    this.jointInfo.style.bottom = "16px";
    this.jointInfo.style.right = "16px";
    this.jointInfo.style.background = "rgba(0,0,0,0.7)";
    this.jointInfo.style.color = "#fff";
    this.jointInfo.style.padding = "8px 12px";
    this.jointInfo.style.borderRadius = "8px";
    this.jointInfo.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    this.jointInfo.style.fontSize = "13px";
    this.jointInfo.style.fontWeight = "500";
    this.jointInfo.style.display = "none";
    this.jointInfo.style.zIndex = "1000";
    document.body.appendChild(this.jointInfo);

    // Arrow to show drag direction
    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      15,
      0x666666
    );
    this.arrow.setLength(15, 3, 1);
    this.scene.add(this.arrow);
    this.arrow.line.material.transparent = true;
    this.arrow.cone.material.transparent = true;
    this.arrow.line.material.opacity = 0.5;
    this.arrow.cone.material.opacity = 0.5;
    this.arrow.visible = false;

    this.previouslySelected = null;
    this.highlightColor = 0xff0000;

    this.localHit = new THREE.Vector3();
    this.worldHit = new THREE.Vector3();
    this.currentWorld = new THREE.Vector3();
    this.originalJointPos = new THREE.Vector3();

    // Event listeners - initially disabled until enabled
    this.enabled = false;
    this.container = container;
    this.boundOnPointer = this.onPointer.bind(this);
  }

  enable() {
    if (!this.enabled) {
      this.enabled = true;
      this.container.addEventListener("pointerdown", this.boundOnPointer, true);
      document.addEventListener("pointermove", this.boundOnPointer, true);
      document.addEventListener("pointerup", this.boundOnPointer, true);
      document.addEventListener("pointerout", this.boundOnPointer, true);
      this.container.addEventListener("dblclick", this.boundOnPointer, false);
    }
  }

  disable() {
    if (this.enabled) {
      this.enabled = false;
      this.container.removeEventListener(
        "pointerdown",
        this.boundOnPointer,
        true
      );
      document.removeEventListener("pointermove", this.boundOnPointer, true);
      document.removeEventListener("pointerup", this.boundOnPointer, true);
      document.removeEventListener("pointerout", this.boundOnPointer, true);
      this.container.removeEventListener(
        "dblclick",
        this.boundOnPointer,
        false
      );

      // End any active dragging
      if (this.active) {
        this.end();
      }
    }
  }

  updateRaycaster(x, y) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mousePos.x = ((x - rect.left) / rect.width) * 2 - 1;
    this.mousePos.y = -((y - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mousePos, this.camera);
  }

  start(x, y) {
    this.draggedJoint = null;
    this.updateRaycaster(x, y);

    // Find all objects in the scene
    const allObjects = [];
    this.scene.traverse((obj) => {
      if (obj.isMesh && obj.bodyID !== undefined) {
        allObjects.push(obj);
      }
    });

    // Optional debug: detected body IDs and simulation info (removed for production)

    const intersects = this.raycaster.intersectObjects(allObjects);

    for (let i = 0; i < intersects.length; i++) {
      const obj = intersects[i].object;
      if (obj.bodyID !== undefined && obj.bodyID > 0) {
        this.draggedJoint = obj;
        this.grabDistance = intersects[0].distance;

        const hit = this.raycaster.ray.origin.clone();
        hit.addScaledVector(this.raycaster.ray.direction, this.grabDistance);

        this.arrow.position.copy(hit);
        this.jointIndicator.position.copy(hit);

        this.active = true;
        this.controls.enabled = false;

        this.localHit = obj.worldToLocal(hit.clone());
        this.worldHit.copy(hit);
        this.currentWorld.copy(hit);
        this.originalJointPos.copy(hit);

        // Hide visual indicators during drag for cleaner experience
        // this.arrow.visible = true;
        // this.jointIndicator.visible = true;

        // Find and show joint info
        const jointInfo = this.findBodyJoint(obj.bodyID);
        this.showJointInfo(obj.bodyID, jointInfo);

        // Optional debug info for development
        // console.log("Started joint drag for bodyID:", obj.bodyID);

        // Dragging joint started
        break;
      }
    }
  }

  move(x, y) {
    if (this.active && this.draggedJoint) {
      this.updateRaycaster(x, y);
      const hit = this.raycaster.ray.origin.clone();
      hit.addScaledVector(this.raycaster.ray.direction, this.grabDistance);
      this.currentWorld.copy(hit);

      this.update();
      this.updateJointPosition();
    }
  }

  update() {
    if (
      this.worldHit &&
      this.localHit &&
      this.currentWorld &&
      this.draggedJoint
    ) {
      this.worldHit.copy(this.localHit);
      this.draggedJoint.localToWorld(this.worldHit);

      // Skip visual indicator updates since they're hidden
      // this.arrow.position.copy(this.worldHit);
      // this.arrow.setDirection(
      //   this.currentWorld.clone().sub(this.worldHit).normalize()
      // );
      // this.arrow.setLength(
      //   this.currentWorld.clone().sub(this.worldHit).length()
      // );
      // this.jointIndicator.position.copy(this.currentWorld);
    }
  }

  updateJointPosition() {
    if (!this.draggedJoint || !this.simulation || !this.model) return;

    const bodyID = this.draggedJoint.bodyID;
    if (bodyID === undefined || bodyID < 0) return;

    try {
      // Find the joint that affects this body
      const jointInfo = this.findBodyJoint(bodyID);
      if (!jointInfo) {
        console.warn("No joint found for bodyID:", bodyID);
        return;
      }

      // Calculate dampened joint change based on drag (URDF-style)
      const dampedChange = this.calculateJointAngleChange(jointInfo);

      // Apply the dampened joint change
      this.applyJointChange(jointInfo, dampedChange);

      // Forward the simulation to apply changes
      this.simulation.forward();
    } catch (e) {
      console.warn("Failed to update joint position:", e);
    }
  }

  findBodyJoint(bodyID) {
    const model = this.model;

    // Look for joints that directly affect this body
    for (let jntId = 0; jntId < model.njnt; jntId++) {
      // Check if this joint's body matches our target body
      if (model.jnt_bodyid && model.jnt_bodyid[jntId] === bodyID) {
        return {
          jointId: jntId,
          bodyId: bodyID,
          qposAddr: model.jnt_qposadr[jntId],
          jointType: model.jnt_type[jntId], // 0=free, 1=ball, 2=slide, 3=hinge
          axis: model.jnt_axis
            ? [
                model.jnt_axis[jntId * 3 + 0],
                model.jnt_axis[jntId * 3 + 1],
                model.jnt_axis[jntId * 3 + 2],
              ]
            : [0, 0, 1],
        };
      }
    }

    // If no direct joint found, look for parent body joints
    let parentBodyId = bodyID;
    while (parentBodyId > 0) {
      parentBodyId = model.body_parentid[parentBodyId];
      for (let jntId = 0; jntId < model.njnt; jntId++) {
        if (model.jnt_bodyid && model.jnt_bodyid[jntId] === parentBodyId) {
          return {
            jointId: jntId,
            bodyId: parentBodyId,
            qposAddr: model.jnt_qposadr[jntId],
            jointType: model.jnt_type[jntId],
            axis: model.jnt_axis
              ? [
                  model.jnt_axis[jntId * 3 + 0],
                  model.jnt_axis[jntId * 3 + 1],
                  model.jnt_axis[jntId * 3 + 2],
                ]
              : [0, 0, 1],
          };
        }
      }
    }

    return null;
  }

  calculateJointAngleChange(jointInfo) {
    // Get current joint value
    const currentValue = this.simulation.qpos[jointInfo.qposAddr] || 0;

    // Calculate target value based on joint type using URDF-style calculations
    let targetValue = currentValue;

    if (jointInfo.jointType === 3) {
      // Hinge joint (revolute)
      const delta = this.getRevoluteDelta(
        jointInfo,
        this.worldHit,
        this.currentWorld
      );
      targetValue = currentValue + delta;
    } else if (jointInfo.jointType === 2) {
      // Slide joint (prismatic)
      const delta = this.getPrismaticDelta(
        jointInfo,
        this.worldHit,
        this.currentWorld
      );
      targetValue = currentValue + delta;
    } else if (jointInfo.jointType === 1) {
      // Ball joint
      // For ball joints, use simplified rotation around primary axis
      const delta = this.getRevoluteDelta(
        jointInfo,
        this.worldHit,
        this.currentWorld
      );
      targetValue = currentValue + delta;
    }

    // Apply dampening factor for smooth movement (like URDF)
    const dampening = 0.4; // Adjust this for responsiveness vs smoothness
    const dampedChange = (targetValue - currentValue) * dampening;

    // Flip the sign to fix inverted movement
    return -dampedChange;
  }

  getRevoluteDelta(jointInfo, startPoint, endPoint) {
    // Create temporary vectors for calculations (like URDF implementation)
    const tempVector = new THREE.Vector3();
    const tempVector2 = new THREE.Vector3();
    const pivotPoint = new THREE.Vector3();
    const projectedStartPoint = new THREE.Vector3();
    const projectedEndPoint = new THREE.Vector3();
    const plane = new THREE.Plane();

    // Get joint axis in world space
    const jointAxis = new THREE.Vector3(
      jointInfo.axis[0],
      jointInfo.axis[1],
      jointInfo.axis[2]
    );

    // Find the joint's world position (pivot point)
    // For MuJoCo, we can get this from the body position
    const bodyIndex = jointInfo.bodyId * 3;
    if (this.simulation.xpos && bodyIndex + 2 < this.simulation.xpos.length) {
      const mujocoPos = new THREE.Vector3(
        this.simulation.xpos[bodyIndex + 0],
        this.simulation.xpos[bodyIndex + 1],
        this.simulation.xpos[bodyIndex + 2]
      );
      // Convert from MuJoCo to THREE.js coordinates using the utility function
      pivotPoint.copy(mujocoPos);
      // Note: toMujocoPos converts TO MuJoCo, so we need the inverse
      // MuJoCo: x, y, z -> THREE: x, -z, y
      pivotPoint.set(mujocoPos.x, -mujocoPos.z, mujocoPos.y);
    } else {
      // Fallback to using the original hit point
      pivotPoint.copy(startPoint);
    }

    // Set up the plane perpendicular to joint axis
    plane.setFromNormalAndCoplanarPoint(jointAxis, pivotPoint);

    // Project the drag points onto the plane
    plane.projectPoint(startPoint, projectedStartPoint);
    plane.projectPoint(endPoint, projectedEndPoint);

    // Get the directions relative to the pivot
    projectedStartPoint.sub(pivotPoint);
    projectedEndPoint.sub(pivotPoint);

    // Handle zero-length vectors
    if (
      projectedStartPoint.length() < 0.001 ||
      projectedEndPoint.length() < 0.001
    ) {
      return 0;
    }

    // Calculate the angle between the projected vectors
    tempVector.crossVectors(projectedStartPoint, projectedEndPoint);
    const direction = Math.sign(tempVector.dot(jointAxis));
    const angle = projectedEndPoint.angleTo(projectedStartPoint);

    // Apply sensitivity scaling
    const sensitivity = 0.75; // Adjust for desired responsiveness
    return direction * angle * sensitivity;
  }

  getPrismaticDelta(jointInfo, startPoint, endPoint) {
    // Calculate drag vector
    const tempVector = new THREE.Vector3();
    tempVector.subVectors(endPoint, startPoint);

    // Get joint axis
    const jointAxis = new THREE.Vector3(
      jointInfo.axis[0],
      jointInfo.axis[1],
      jointInfo.axis[2]
    );
    jointAxis.normalize();

    // Project drag onto joint axis
    const delta = tempVector.dot(jointAxis);

    // Apply sensitivity scaling
    const sensitivity = 0.03; // Adjust for desired responsiveness
    return delta * sensitivity;
  }

  applyJointChange(jointInfo, change) {
    const qpos = this.simulation.qpos;
    const addr = jointInfo.qposAddr;

    if (addr >= 0 && addr < qpos.length) {
      // Apply the dampened change to the joint position/angle
      qpos[addr] += change;

      // Apply joint limits based on MuJoCo model (if available)
      if (this.model.jnt_limited && this.model.jnt_limited[jointInfo.jointId]) {
        const lowerLimit = this.model.jnt_range
          ? this.model.jnt_range[jointInfo.jointId * 2]
          : -Math.PI;
        const upperLimit = this.model.jnt_range
          ? this.model.jnt_range[jointInfo.jointId * 2 + 1]
          : Math.PI;
        qpos[addr] = Math.max(lowerLimit, Math.min(upperLimit, qpos[addr]));
      } else {
        // Default safety limits
        if (jointInfo.jointType === 3) {
          // Hinge joint - clamp angles
          qpos[addr] = Math.max(
            -2 * Math.PI,
            Math.min(2 * Math.PI, qpos[addr])
          );
        } else if (jointInfo.jointType === 2) {
          // Slide joint - clamp translation
          qpos[addr] = Math.max(-2, Math.min(2, qpos[addr]));
        }
      }
    }
  }

  setBodyPosition(bodyID, targetPosition) {
    if (!this.simulation || !this.simulation.xpos) {
      console.warn("Simulation or xpos not available");
      return;
    }

    // Convert target position to MuJoCo coordinates
    const mujocoPos = toMujocoPos(targetPosition.clone());

    // Assume bodyID is valid if it comes from the scene
    const posIndex = bodyID * 3;
    if (posIndex + 2 < this.simulation.xpos.length) {
      this.simulation.xpos[posIndex + 0] = mujocoPos.x;
      this.simulation.xpos[posIndex + 1] = mujocoPos.y;
      this.simulation.xpos[posIndex + 2] = mujocoPos.z;

      // Forward the simulation to apply the position change
      this.simulation.forward();
    } else {
      console.warn(
        `Position array too small for body ${bodyID}. Array length: ${
          this.simulation.xpos.length
        }, required index: ${posIndex + 2}`
      );
    }
  }

  showJointInfo(bodyID, jointInfo = null) {
    if (jointInfo) {
      const jointTypeName =
        ["free", "ball", "slide", "hinge"][jointInfo.jointType] || "unknown";
      this.jointInfo.innerHTML = `Joint ${jointInfo.jointId} (${jointTypeName})`;
    } else {
      this.jointInfo.innerHTML = `Component ID: ${bodyID}`;
    }
    this.jointInfo.style.display = "none";
  }

  end() {
    this.draggedJoint = null;
    this.active = false;
    this.controls.enabled = true;
    this.arrow.visible = false;
    this.jointIndicator.visible = false;
    this.jointInfo.style.display = "none";
    this.mouseDown = false;

    // Dragging joint stopped
  }

  onPointer(evt) {
    if (!this.enabled) return;

    if (evt.type === "pointerdown") {
      this.start(evt.clientX, evt.clientY);
      this.mouseDown = true;
    } else if (evt.type === "pointermove" && this.mouseDown) {
      if (this.active) {
        this.move(evt.clientX, evt.clientY);
      }
    } else if (evt.type === "pointerup") {
      this.end(evt);
    }

    if (evt.type === "dblclick") {
      this.start(evt.clientX, evt.clientY);
      this.doubleClick = true;

      if (this.draggedJoint) {
        if (this.draggedJoint === this.previouslySelected) {
          this.draggedJoint.material.emissive.setHex(0x000000);
          this.previouslySelected = null;
        } else {
          if (this.previouslySelected) {
            this.previouslySelected.material.emissive.setHex(0x000000);
          }
          this.draggedJoint.material.emissive.setHex(this.highlightColor);
          this.previouslySelected = this.draggedJoint;
        }
      } else {
        if (this.previouslySelected) {
          this.previouslySelected.material.emissive.setHex(0x000000);
          this.previouslySelected = null;
        }
      }
    }
  }
}
