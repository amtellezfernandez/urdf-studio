import { TextureRegistry } from "./TextureRegistry.js";
import {
  HydraMesh,
  HydraCamera,
  HydraLight,
  HydraMaterial,
} from "./HydraPrimitives.js";

const DEBUG_PRIMS = false;

// Used by the driver to create the delegate
export class ThreeRenderDelegateInterface {
  /**
   * @param {import('../../usd-viewer').threeJsRenderDelegateConfig} config
   */
  constructor(config) {
    this.config = config;
    if (DEBUG_PRIMS) console.log("RenderDelegateInterface", config);
    this.registry = new TextureRegistry(config);
    this.materials = {};
    this.meshes = {};
  }

  /**
   * Render Prims. See webRenderDelegate.h and webRenderDelegate.cpp
   * @param {string} typeId // translated from TfToken
   * @param {string} id // SdfPath.GetAsString()
   * @param {*} instancerId
   * @returns
   */
  createRPrim(typeId, id) {
    if (DEBUG_PRIMS) console.log("Creating RPrim:", typeId, id);
    const mesh = new HydraMesh(id, this);
    this.meshes[id] = mesh;
    return mesh;
  }

  createBPrim(typeId, id) {
    if (DEBUG_PRIMS) console.log("Creating BPrim:", typeId, id);
  }

  createSPrim(typeId, id) {
    if (DEBUG_PRIMS) console.log("Creating SPrim:", typeId, id);
    const t = String(typeId || "").toLowerCase();
    if (t === "material") {
      const material = new HydraMaterial(id, this);
      this.materials[id] = material;
      return material;
    }
    // Acknowledge camera and light sprims to prevent hydra warnings
    if (t === "camera") {
      return new HydraCamera(id, this);
    }
    if (t.includes("light")) {
      return new HydraLight(id, this);
    }
  }

  CommitResources() {
    for (const id in this.meshes) {
      const hydraMesh = this.meshes[id];
      hydraMesh.commit();
    }
  }
}
