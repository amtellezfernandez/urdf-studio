import * as THREE from "three";

/** Loads a scene for MuJoCo
 * @param {mujoco} mujoco This is a reference to the mujoco namespace object
 * @param {string} filename This is the name of the .xml file in the /working/ directory of the MuJoCo/Emscripten Virtual File System
 * @param {MujocoSimulator} parent The three.js Scene Object to add the MuJoCo model elements to
 */
export async function loadSceneFromURL(mujoco, filename, parent) {
  // Free the old simulation.
  if (parent.simulation != null) {
    parent.simulation.free();
    parent.model = null;
    parent.state = null;
    parent.simulation = null;
  }

  // Load in the state from XML.
  const xmlVfsPath = "/working/" + filename;
  try {
    const exists = mujoco.FS.analyzePath(xmlVfsPath).exists;
    if (!exists) {
      throw new Error(`XML not found in VFS: ${xmlVfsPath}`);
    }
    // Sanity: ensure non-empty and looks like XML
    const xmlText = mujoco.FS.readFile(xmlVfsPath, { encoding: "utf8" });
    if (!xmlText || !String(xmlText).includes("<mujoco")) {
      throw new Error(
        `XML appears invalid or empty at ${xmlVfsPath} (length=${
          xmlText?.length ?? 0
        })`
      );
    }
    parent.model = mujoco.Model.load_from_xml(xmlVfsPath);
  } catch (err) {
    // Re-throw with additional context for easier debugging
    const contextMsg = `Failed to compile MJCF at ${xmlVfsPath}`;
    throw new Error(`${contextMsg}: ${String(err)}`);
  }
  parent.state = new mujoco.State(parent.model);
  parent.simulation = new mujoco.Simulation(parent.model, parent.state);

  let model = parent.model;
  let state = parent.state;
  let simulation = parent.simulation;

  // Decode the null-terminated string names.
  let textDecoder = new TextDecoder("utf-8");
  let names_array = new Uint8Array(model.names);
  let fullString = textDecoder.decode(model.names);
  let names = fullString.split(textDecoder.decode(new ArrayBuffer(1)));

  // Create the root object.
  let mujocoRoot = new THREE.Group();
  mujocoRoot.name = "MuJoCo Root";
  parent.scene.add(mujocoRoot);

  /** @type {Object.<number, THREE.Group>} */
  let bodies = {};
  /** @type {Object.<number, THREE.BufferGeometry>} */
  let meshes = {};
  /** @type {THREE.Light[]} */
  let lights = [];

  // Default material definition.
  let material = new THREE.MeshPhysicalMaterial();
  material.color = new THREE.Color(1, 1, 1);

  // Loop through the MuJoCo geoms and recreate them in three.js.
  for (let g = 0; g < model.ngeom; g++) {
    // Only visualize geom groups up to 2 (same default behavior as simulate).
    if (!(model.geom_group[g] < 3)) {
      continue;
    }

    // Get the body ID and type of the geom.
    let b = model.geom_bodyid[g];
    let type = model.geom_type[g];
    let size = [
      model.geom_size[g * 3 + 0],
      model.geom_size[g * 3 + 1],
      model.geom_size[g * 3 + 2],
    ];

    // Create the body if it doesn't exist.
    if (!(b in bodies)) {
      bodies[b] = new THREE.Group();

      let start_idx = model.name_bodyadr[b];
      let end_idx = start_idx;
      while (end_idx < names_array.length && names_array[end_idx] !== 0) {
        end_idx++;
      }
      let name_buffer = names_array.subarray(start_idx, end_idx);
      bodies[b].name = textDecoder.decode(name_buffer);

      bodies[b].bodyID = b;
      bodies[b].has_custom_mesh = false;
    }

    // Set the default geometry. In MuJoCo, this is a sphere.
    let geometry = new THREE.SphereGeometry(size[0] * 0.5);
    if (type == mujoco.mjtGeom.mjGEOM_PLANE.value) {
      // Special handling for plane later.
    } else if (type == mujoco.mjtGeom.mjGEOM_HFIELD.value) {
      // TODO: Implement this.
    } else if (type == mujoco.mjtGeom.mjGEOM_SPHERE.value) {
      geometry = new THREE.SphereGeometry(size[0]);
    } else if (type == mujoco.mjtGeom.mjGEOM_CAPSULE.value) {
      geometry = new THREE.CapsuleGeometry(size[0], size[1] * 2.0, 20, 20);
    } else if (type == mujoco.mjtGeom.mjGEOM_ELLIPSOID.value) {
      geometry = new THREE.SphereGeometry(1); // Stretch this below
    } else if (type == mujoco.mjtGeom.mjGEOM_CYLINDER.value) {
      geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2.0);
    } else if (type == mujoco.mjtGeom.mjGEOM_BOX.value) {
      geometry = new THREE.BoxGeometry(
        size[0] * 2.0,
        size[2] * 2.0,
        size[1] * 2.0
      );
    } else if (type == mujoco.mjtGeom.mjGEOM_MESH.value) {
      let meshID = model.geom_dataid[g];

      if (!(meshID in meshes)) {
        geometry = new THREE.BufferGeometry(); // TODO: Populate the Buffer Geometry with Generic Mesh Data

        let vertex_buffer = model.mesh_vert.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3
        );
        for (let v = 0; v < vertex_buffer.length; v += 3) {
          //vertex_buffer[v + 0] =  vertex_buffer[v + 0];
          let temp = vertex_buffer[v + 1];
          vertex_buffer[v + 1] = vertex_buffer[v + 2];
          vertex_buffer[v + 2] = -temp;
        }

        let normal_buffer = model.mesh_normal.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3
        );
        for (let v = 0; v < normal_buffer.length; v += 3) {
          //normal_buffer[v + 0] =  normal_buffer[v + 0];
          let temp = normal_buffer[v + 1];
          normal_buffer[v + 1] = normal_buffer[v + 2];
          normal_buffer[v + 2] = -temp;
        }

        let uv_buffer = model.mesh_texcoord.subarray(
          model.mesh_texcoordadr[meshID] * 2,
          (model.mesh_texcoordadr[meshID] + model.mesh_vertnum[meshID]) * 2
        );
        let triangle_buffer = model.mesh_face.subarray(
          model.mesh_faceadr[meshID] * 3,
          (model.mesh_faceadr[meshID] + model.mesh_facenum[meshID]) * 3
        );
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(vertex_buffer, 3)
        );
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(normal_buffer, 3)
        );
        geometry.setAttribute("uv", new THREE.BufferAttribute(uv_buffer, 2));
        geometry.setIndex(Array.from(triangle_buffer));
        meshes[meshID] = geometry;
      } else {
        geometry = meshes[meshID];
      }

      bodies[b].has_custom_mesh = true;
    }
    // Done with geometry creation.

    // Set the Material Properties of incoming bodies
    let texture = undefined;
    let color = [
      model.geom_rgba[g * 4 + 0],
      model.geom_rgba[g * 4 + 1],
      model.geom_rgba[g * 4 + 2],
      model.geom_rgba[g * 4 + 3],
    ];
    if (model.geom_matid[g] != -1) {
      let matId = model.geom_matid[g];
      color = [
        model.mat_rgba[matId * 4 + 0],
        model.mat_rgba[matId * 4 + 1],
        model.mat_rgba[matId * 4 + 2],
        model.mat_rgba[matId * 4 + 3],
      ];

      // Construct Texture from model.tex_rgb
      texture = undefined;
      let texId = model.mat_texid[matId];
      if (texId != -1) {
        let width = model.tex_width[texId];
        let height = model.tex_height[texId];
        let offset = model.tex_adr[texId];
        let rgbArray = model.tex_rgb;
        let rgbaArray = new Uint8Array(width * height * 4);
        for (let p = 0; p < width * height; p++) {
          rgbaArray[p * 4 + 0] = rgbArray[offset + (p * 3 + 0)];
          rgbaArray[p * 4 + 1] = rgbArray[offset + (p * 3 + 1)];
          rgbaArray[p * 4 + 2] = rgbArray[offset + (p * 3 + 2)];
          rgbaArray[p * 4 + 3] = 1.0;
        }
        texture = new THREE.DataTexture(
          rgbaArray,
          width,
          height,
          THREE.RGBAFormat,
          THREE.UnsignedByteType
        );
        if (texId == 2) {
          texture.repeat = new THREE.Vector2(50, 50);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
        } else {
          texture.repeat = new THREE.Vector2(1, 1);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
        }

        texture.needsUpdate = true;
      }
    }

    if (
      material.color.r != color[0] ||
      material.color.g != color[1] ||
      material.color.b != color[2] ||
      material.opacity != color[3] ||
      material.map != texture
    ) {
      const materialProps = {
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: color[3] < 1.0,
        opacity: color[3],
        ...(texture !== undefined ? { map: texture } : {}),
      };

      // Only add material properties if they exist
      if (model.geom_matid[g] != -1) {
        materialProps.specularIntensity =
          model.mat_specular[model.geom_matid[g]] * 0.5;
        materialProps.reflectivity = model.mat_reflectance[model.geom_matid[g]];
        materialProps.roughness =
          1.0 - model.mat_shininess[model.geom_matid[g]];
        materialProps.metalness = 0.1;
      }

      material = new THREE.MeshPhysicalMaterial(materialProps);
    }

    let mesh = new THREE.Mesh(geometry, material);

    mesh.castShadow = g == 0 ? false : true;
    mesh.receiveShadow = type != 7;
    mesh.bodyID = b;
    bodies[b].add(mesh);
    getPosition(model.geom_pos, g, mesh.position);
    if (type != 0) {
      getQuaternion(model.geom_quat, g, mesh.quaternion);
    }
    if (type == 4) {
      mesh.scale.set(size[0], size[2], size[1]);
    } // Stretch the Ellipsoid
  }

  // Parse tendons.
  let tendonMat = new THREE.MeshPhongMaterial();
  tendonMat.color = new THREE.Color(0.8, 0.3, 0.3);
  mujocoRoot.cylinders = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1),
    tendonMat,
    1023
  );
  mujocoRoot.cylinders.receiveShadow = true;
  mujocoRoot.cylinders.castShadow = true;
  mujocoRoot.cylinders.count = 0; // Hide by default
  mujocoRoot.add(mujocoRoot.cylinders);
  mujocoRoot.spheres = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 10),
    tendonMat,
    1023
  );
  mujocoRoot.spheres.receiveShadow = true;
  mujocoRoot.spheres.castShadow = true;
  mujocoRoot.spheres.count = 0; // Hide by default
  mujocoRoot.add(mujocoRoot.spheres);

  // Parse lights.
  for (let l = 0; l < model.nlight; l++) {
    let light = new THREE.SpotLight();
    if (model.light_directional[l]) {
      light = new THREE.DirectionalLight();
    } else {
      light = new THREE.SpotLight();
    }
    light.decay = model.light_attenuation[l] * 100;
    light.penumbra = 0.5;
    light.castShadow = true; // default false

    light.shadow.mapSize.width = 1024; // default
    light.shadow.mapSize.height = 1024; // default
    light.shadow.camera.near = 1; // default
    light.shadow.camera.far = 10; // default
    //bodies[model.light_bodyid()].add(light);
    if (bodies[0]) {
      bodies[0].add(light);
    } else {
      mujocoRoot.add(light);
    }
    lights.push(light);
  }
  if (model.nlight == 0) {
    let light = new THREE.DirectionalLight();
    mujocoRoot.add(light);
  }

  for (let b = 0; b < model.nbody; b++) {
    // Ensure a THREE.Group exists for every body index before attaching
    if (!bodies[b]) {
      bodies[b] = new THREE.Group();
      // Derive a sensible default name if not present
      try {
        bodies[b].name = names[b + 1] || `body_${b}`;
      } catch {
        bodies[b].name = `body_${b}`;
      }
      bodies[b].bodyID = b;
      bodies[b].has_custom_mesh = false;
    }

    // Attach all bodies directly under the root. We update with world transforms,
    // so nesting would double-apply transforms and scramble the initial pose.
    mujocoRoot.add(bodies[b]);
  }

  parent.mujocoRoot = mujocoRoot;

  return [model, state, simulation, bodies, lights];
}

/** Ensure a specific public MJCF XML path and its dependencies are present in MuJoCo's VFS.
 * Fetches only what's needed on-demand (no prefetch of entire folders).
 * - Supports recursive <include file="..."/>
 * - Fetches assets referenced via <asset> elements (e.g., <mesh file=...>, <texture file=...>)
 */
export async function stageMjcfSceneToVfs(mujoco, path, options = {}) {
  const basePrefix = "../mjcf/";
  async function ensureDir(fullPath) {
    const parts = fullPath.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc += (i === 0 ? "" : "/") + parts[i];
      if (!mujoco.FS.analyzePath(acc).exists) mujoco.FS.mkdir(acc);
    }
  }

  async function writeBinary(fullPath, data) {
    await ensureDir(fullPath);
    mujoco.FS.writeFile(fullPath, new Uint8Array(await data.arrayBuffer()));
  }

  async function writeText(fullPath, text) {
    await ensureDir(fullPath);
    mujoco.FS.writeFile(fullPath, text);
  }

  const visited = new Set();

  // Write uploaded scene files (if provided)
  // options: { files?: { path: string, buffer: ArrayBuffer|Uint8Array|Blob|string }[], xml?: { fileName: string, content: string } }
  if (Array.isArray(options.files) && options.files.length > 0) {
    for (const entry of options.files) {
      if (!entry?.path) continue;
      const relPath = entry.path.startsWith("/")
        ? entry.path.slice(1)
        : entry.path;
      const vfsPath = "/working/" + relPath;
      await ensureDir(vfsPath);

      const lower = relPath.toLowerCase();
      const isBinary = [
        ".png",
        ".jpg",
        ".jpeg",
        ".bmp",
        ".gif",
        ".tga",
        ".dds",
        ".ktx",
        ".ktx2",
        ".hdr",
        ".exr",
        ".obj",
        ".stl",
        ".ply",
        ".glb",
        ".gltf",
        ".skn",
        ".bin",
      ].some((ext) => lower.endsWith(ext));

      const buf = entry.buffer;
      if (buf instanceof Uint8Array) {
        mujoco.FS.writeFile(vfsPath, buf);
      } else if (buf instanceof ArrayBuffer) {
        mujoco.FS.writeFile(vfsPath, new Uint8Array(buf));
      } else if (typeof Blob !== "undefined" && buf instanceof Blob) {
        mujoco.FS.writeFile(vfsPath, new Uint8Array(await buf.arrayBuffer()));
      } else if (typeof buf === "string" && !isBinary) {
        mujoco.FS.writeFile(vfsPath, buf);
      } else if (buf != null) {
        // Fallback: try to coerce to bytes if possible
        try {
          const maybeBytes = new Uint8Array(buf);
          mujoco.FS.writeFile(vfsPath, maybeBytes);
        } catch {
          // Last resort: write empty to at least create the file
          mujoco.FS.writeFile(vfsPath, new Uint8Array());
        }
      } else {
        // No buffer provided; create empty file placeholder
        mujoco.FS.writeFile(vfsPath, new Uint8Array());
      }
    }
  }

  if (options.xml?.fileName && options.xml?.content != null) {
    const rel = options.xml.fileName.startsWith("/")
      ? options.xml.fileName.slice(1)
      : options.xml.fileName;
    await ensureDir("/working/" + rel);
    mujoco.FS.writeFile("/working/" + rel, options.xml.content);
  }

  async function loadXmlRecursive(relPath) {
    const vfsPath = "/working/" + relPath;
    if (visited.has(relPath)) return;
    visited.add(relPath);
    if (!mujoco.FS.analyzePath(vfsPath).exists) {
      throw new Error(`Missing referenced XML in scene: ${relPath}`);
    }

    // Parse and find dependencies
    const xmlText = mujoco.FS.readFile(vfsPath, { encoding: "utf8" });
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");

    // Resolve <include file="..."/>
    const includes = Array.from(doc.querySelectorAll("include[file]"));
    for (const inc of includes) {
      const file = inc.getAttribute("file");
      if (!file) continue;
      const includePath = joinRelative(relPath, file);
      await loadXmlRecursive(includePath);
    }

    // Resolve <asset> file references (mesh, texture, hfield, skin)
    // Respect optional compiler directories: meshdir, texturedir, skindir, hfielddir.
    const compilerEl = doc.querySelector("compiler");
    const meshdir = compilerEl?.getAttribute("meshdir") || "assets";
    const texturedir = compilerEl?.getAttribute("texturedir") || meshdir;
    const skindir = compilerEl?.getAttribute("skindir") || meshdir;
    const hfielddir = compilerEl?.getAttribute("hfielddir") || texturedir;

    const dirForTag = (tagName) => {
      switch (tagName) {
        case "mesh":
          return meshdir;
        case "texture":
          return texturedir;
        case "skin":
          return skindir;
        case "hfield":
          return hfielddir;
        default:
          return meshdir;
      }
    };

    const binaryExts = [
      ".png",
      ".jpg",
      ".jpeg",
      ".bmp",
      ".gif",
      ".tga",
      ".dds",
      ".ktx",
      ".ktx2",
      ".hdr",
      ".exr",
      ".obj",
      ".stl",
      ".ply",
      ".glb",
      ".gltf",
      ".skn",
      ".bin",
    ];

    const assetSelectors = [
      "mesh[file]",
      "texture[file]",
      "hfield[file]",
      "skin[file]",
    ];
    for (const sel of assetSelectors) {
      const nodes = Array.from(doc.querySelectorAll(sel));
      for (const n of nodes) {
        const file = n.getAttribute("file");
        if (!file) continue;

        const tag = n.tagName.toLowerCase();
        const baseDir = dirForTag(tag);
        const combined = baseDir ? `${baseDir}/${file}` : file;
        const assetRel = joinRelative(relPath, combined);
        const fullVfs = "/working/" + assetRel;

        if (!mujoco.FS.analyzePath(fullVfs).exists) {
          // Require assets to have been provided by caller
          throw new Error(`Missing referenced asset in scene: ${assetRel}`);
        }
      }
    }
  }

  // Helper to resolve relative paths based on current XML file location
  function joinRelative(currentRelPath, relative) {
    if (
      relative.startsWith("/") ||
      relative.startsWith("./") ||
      relative.startsWith("../")
    ) {
      const baseParts = currentRelPath.split("/");
      baseParts.pop();
      const relParts = relative.split("/");
      const stack = baseParts;
      for (const part of relParts) {
        if (part === "." || part === "") continue;
        if (part === "..") stack.pop();
        else stack.push(part);
      }
      return stack.join("/");
    }
    // simple same-folder reference
    const baseParts = currentRelPath.split("/");
    baseParts.pop();
    return [...baseParts, relative].join("/");
  }

  // Determine root XML to stage
  let rootRel = (path || "").replace(/^\/+/, "");
  if (!rootRel) {
    if (options.xml?.fileName) {
      rootRel = options.xml.fileName.replace(/^\/+/, "");
    } else if (Array.isArray(options.files)) {
      const xmlEntry = options.files.find((f) =>
        (f?.path || "").toLowerCase().endsWith(".xml")
      );
      if (xmlEntry?.path) rootRel = xmlEntry.path.replace(/^\/+/, "");
    }
  }
  if (!rootRel) {
    throw new Error("stageMjcfSceneToVfs: No root XML provided or detected");
  }

  await loadXmlRecursive(rootRel);

  // Return the normalized root so callers can use it with loadSceneFromURL
  return rootRel;
}

/** Access the vector at index, swizzle for three.js, and apply to the target THREE.Vector3
 * @param {Float32Array|Float64Array} buffer
 * @param {number} index
 * @param {THREE.Vector3} target */
export function getPosition(buffer, index, target, swizzle = true) {
  if (swizzle) {
    return target.set(
      buffer[index * 3 + 0],
      buffer[index * 3 + 2],
      -buffer[index * 3 + 1]
    );
  } else {
    return target.set(
      buffer[index * 3 + 0],
      buffer[index * 3 + 1],
      buffer[index * 3 + 2]
    );
  }
}

/** Access the quaternion at index, swizzle for three.js, and apply to the target THREE.Quaternion
 * @param {Float32Array|Float64Array} buffer
 * @param {number} index
 * @param {THREE.Quaternion} target */
export function getQuaternion(buffer, index, target, swizzle = true) {
  if (swizzle) {
    return target.set(
      -buffer[index * 4 + 1],
      -buffer[index * 4 + 3],
      buffer[index * 4 + 2],
      -buffer[index * 4 + 0]
    );
  } else {
    return target.set(
      buffer[index * 4 + 0],
      buffer[index * 4 + 1],
      buffer[index * 4 + 2],
      buffer[index * 4 + 3]
    );
  }
}

/** Converts this Vector3's Handedness to MuJoCo's Coordinate Handedness
 * @param {THREE.Vector3} target */
export function toMujocoPos(target) {
  return target.set(target.x, -target.z, target.y);
}

/** Standard normal random number generator using Box-Muller transform */
export function standardNormal() {
  return (
    Math.sqrt(-2.0 * Math.log(Math.random())) *
    Math.cos(2.0 * Math.PI * Math.random())
  );
}

export function removeAllMujocoRoots(viewer) {
  try {
    let root;
    while ((root = viewer.scene.getObjectByName("MuJoCo Root"))) {
      viewer.scene.remove(root);
    }
  } catch (e) {
    console.warn("Failed to clear MuJoCo roots", e);
  }
}
