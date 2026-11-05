import {
  BufferGeometry,
  MeshPhysicalMaterial,
  DoubleSide,
  Color,
  Mesh,
  Float32BufferAttribute,
  SRGBColorSpace,
  RGBAFormat,
  RepeatWrapping,
  LinearSRGBColorSpace,
  Vector2,
} from "three";

const DEBUG = {
  textures: false,
  materials: false,
  meshes: false,
};
const DISABLE_MATERIALS = false;

let warningMessagesToCount = new Map();

/** @type {MeshPhysicalMaterial} */
let defaultMaterial;

export class HydraMesh {
  /**
   * @param {string} id
   * @param {import('./ThreeRenderDelegateInterface.js').ThreeRenderDelegateInterface} hydraInterface
   */
  constructor(id, hydraInterface) {
    this._geometry = new BufferGeometry();
    this._id = id;
    this._interface = hydraInterface;
    this._points = undefined;
    this._normals = undefined;
    this._colors = undefined;
    this._uvs = undefined;
    this._indices = undefined;
    this._materials = [];

    let material = new MeshPhysicalMaterial({
      side: DoubleSide,
      color: new Color(0xb4b4b4),
      // envMap: hydraInterface.config.envMap,
    });
    this._materials.push(material);
    this._mesh = new Mesh(this._geometry, material);
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = true;

    // ID can contain paths, we strip those here
    let _name = id;
    let lastSlash = _name.lastIndexOf("/");
    if (lastSlash >= 0) {
      _name = _name.substring(lastSlash + 1);
    }
    this._mesh.name = _name;

    // console.log("Creating HydraMesh: " + id + " -> " + _name);

    hydraInterface.config.usdRoot.add(this._mesh); // FIXME
   
  }

  updateOrder(attribute, attributeName, dimension = 3) {
    if (DEBUG.meshes) console.log("updateOrder", attributeName, dimension);
    if (attribute && this._indices) {
      const values = [];
      for (let i = 0; i < this._indices.length; i++) {
        const index = this._indices[i];
        for (let j = 0; j < dimension; ++j) {
          values.push(attribute[dimension * index + j]);
        }
      }
      this._geometry.setAttribute(
        attributeName,
        new Float32BufferAttribute(values, dimension)
      );
    }
  }

  updateIndices(indices) {
    if (DEBUG.meshes) console.log("updateIndices", indices.length);
    this._indices = [...indices];
    this.updateOrder(this._points, "position");
    this.updateOrder(this._normals, "normal");
    if (this._colors) this.updateOrder(this._colors, "color");
    if (this._uvs) {
      this.updateOrder(this._uvs, "uv", 2);
      this._geometry.attributes.uv2 = this._geometry.attributes.uv;
    }
  }

  /**
   * Sets the transform of the mesh.
   * @param {Iterable<number>} matrix - The 4x4 matrix to set on the mesh.
   */
  setTransform(matrix) {
    this._mesh.matrix.set(...matrix);
    this._mesh.matrix.transpose();
    this._mesh.matrixAutoUpdate = false;
  }

  /**
   * Sets automatically generated normals on the mesh. Should only be used if there are no authored normals.
   * @param {} normals
   */
  updateNormals(normals) {
    // don't apply automatically generated normals if there are already authored normals.
    if (this._geometry.hasAttribute("normal")) return;

    this._normals = normals.slice(0);
    this.updateOrder(this._normals, "normal");
  }

  setNormals(data, interpolation) {
    if (interpolation === "facevarying") {
      // The UV buffer has already been prepared on the C++ side, so we just set it
      this._geometry.setAttribute(
        "normal",
        new Float32BufferAttribute(data, 3)
      );
    } else if (interpolation === "vertex") {
      // We have per-vertex UVs, so we need to sort them accordingly
      this._normals = data.slice(0);
      this.updateOrder(this._normals, "normal");
    }
  }

  setMaterial(materialId) {
    if (DEBUG.materials) console.log("Setting material:", materialId);
    const material = this._interface.materials[materialId];
    if (material) {
      this._mesh.material = material._material;
    } else {
      console.error("Material not found:", materialId);
    }
  }

  setGeomSubsetMaterial(sections) {
    //console.log("setting subset material: ", this._id, sections)

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (this._interface.materials[section.materialId]) {
        this._materials.push(
          this._interface.materials[section.materialId]._material
        );
        this._geometry.addGroup(section.start, section.length, i + 1);
      }
    }
    this._mesh = new Mesh(this._geometry, this._materials);
    this._interface.config.usdRoot.add(this._mesh);
  }

  setDisplayColor(data, interpolation) {
    if (DISABLE_MATERIALS) return;

    const wasDefaultMaterial = this._mesh.material === defaultMaterial;
    if (wasDefaultMaterial) {
      this._mesh.material = this._mesh.material.clone();
    }

    this._colors = null;

    if (interpolation === "constant") {
      this._mesh.material.color = new Color().fromArray(data);
    } else if (interpolation === "vertex") {
      this._mesh.material.vertexColors = true;
      if (wasDefaultMaterial) this._mesh.material.color = new Color(0xffffff);
      this._colors = data.slice(0);
      this.updateOrder(this._colors, "color");
    } else {
      const count = warningMessagesToCount.get(interpolation) || 0;
      warningMessagesToCount.set(interpolation, count + 1);
      if (count === 0) {
        console.warn(
          `Unsupported displayColor interpolation type '${interpolation}'.`
        );
      }
    }
  }

  setUV(data, dimension, interpolation) {
    // TODO: Support multiple UVs. For now, we simply set uv = uv2, which is required when a material has an aoMap.
    this._uvs = null;

    if (interpolation === "facevarying") {
      // The UV buffer has already been prepared on the C++ side, so we just set it
      this._geometry.setAttribute(
        "uv",
        new Float32BufferAttribute(data, dimension)
      );
    } else if (interpolation === "vertex") {
      // We have per-vertex UVs, so we need to sort them accordingly
      this._uvs = data.slice(0);
      this.updateOrder(this._uvs, "uv", 2);
    }

    if (this._geometry.hasAttribute("uv"))
      this._geometry.attributes.uv2 = this._geometry.attributes.uv;
  }

  updatePrimvar(name, data, dimension, interpolation) {
    if (!name) return;

    if (name === "points") {
      // || name === 'normals') {
      // Points and normals are set separately
      return;
    }

    // console.log('Setting PrimVar: ' + name + ", interpolation: " + interpolation);

    // TODO: Support multiple UVs. For now, we simply set uv = uv2, which is required when a material has an aoMap.
    if (name.startsWith("st")) {
      name = "uv";
    }

    const uvNames = ["uv", "uvmap", "uv0", "uvw", "map1"];
    const normalizedName = name.toLowerCase();

    if (name === "displayColor") {
      this.setDisplayColor(data, interpolation);
    } else if (uvNames.includes(normalizedName)) {
      this.setUV(data, dimension, interpolation);
    } else if (name === "normals") {
      this.setNormals(data, interpolation);
    } else {
      const count = warningMessagesToCount.get(name) || 0;
      warningMessagesToCount.set(name, count + 1);
      if (count === 0) console.warn("Unsupported primvar:", name);
    }
  }

  updatePoints(points) {
    this._points = points.slice(0);
    this.updateOrder(this._points, "position")
  }

  commit() {
    // All Three.js resources are already updated during the sync phase.
  }
}

// Stub classes for camera and light prims to prevent Hydra warnings
export class HydraCamera {
  constructor(id, hydraInterface) {
    this._id = id;
    this._interface = hydraInterface;
  }
}

export class HydraLight {
  constructor(id, hydraInterface) {
    this._id = id;
    this._interface = hydraInterface;
  }
}

export class HydraMaterial {
  // Maps USD preview material texture names to Three.js MeshPhysicalMaterial names
  static usdPreviewToMeshPhysicalTextureMap = {
    diffuseColor: "map",
    clearcoat: "clearcoatMap",
    clearcoatRoughness: "clearcoatRoughnessMap",
    emissiveColor: "emissiveMap",
    occlusion: "aoMap",
    roughness: "roughnessMap",
    metallic: "metalnessMap",
    normal: "normalMap",
    opacity: "alphaMap",
  };

  static usdPreviewToColorSpaceMap = {
    diffuseColor: SRGBColorSpace,
    emissiveColor: SRGBColorSpace,
    opacity: SRGBColorSpace,
  };

  static channelMap = {
    // Three.js expects many 8bit values such as roughness or metallness in a specific RGB texture channel.
    // We could write code to combine multiple 8bit texture files into different channels of one RGB texture where it
    // makes sense, but that would complicate this loader a lot. Most Three.js loaders don't seem to do it either.
    // Instead, we simply provide the 8bit image as an RGBA texture, even though this might be less efficient.
    r: RGBAFormat,
    g: RGBAFormat,
    b: RGBAFormat,
    rgb: RGBAFormat,
    rgba: RGBAFormat,
  };

  // Maps USD preview material property names to Three.js MeshPhysicalMaterial names
  static usdPreviewToMeshPhysicalMap = {
    clearcoat: "clearcoat",
    clearcoatRoughness: "clearcoatRoughness",
    diffuseColor: "color",
    emissiveColor: "emissive",
    ior: "ior",
    metallic: "metalness",
    opacity: "opacity",
    roughness: "roughness",
    opacityThreshold: "alphaTest",
  };

  constructor(id, hydraInterface) {
    this._id = id;
    this._nodes = {};
    this._interface = hydraInterface;

    if (!defaultMaterial) {
      defaultMaterial = new MeshPhysicalMaterial({
        side: DoubleSide,
        color: new Color(DISABLE_MATERIALS ? 0x999999 : 0xff2997),
        name: "DefaultMaterial",
      });
    }

    this._material = defaultMaterial;
    if (DEBUG.materials) console.log("Hydra Material", this);
  }

  updateNode(networkId, path, parameters) {
    if (DEBUG.textures) console.log("Updating Material Node:", networkId, path);
    this._nodes[path] = parameters;
  }

  convertWrap(usdWrapMode) {
    if (usdWrapMode === undefined) return RepeatWrapping;

    const WRAPPINGS = {
      repeat: 1000, // RepeatWrapping
      clamp: 1001, // ClampToEdgeWrapping
      mirror: 1002, // MirroredRepeatWrapping
    };

    if (WRAPPINGS[usdWrapMode]) return WRAPPINGS[usdWrapMode];

    return RepeatWrapping;
  }

  /**
   * @return {Promise<void>}
   */
  assignTexture(mainMaterial, parameterName) {
    return new Promise((resolve) => {
      const materialParameterMapName =
        HydraMaterial.usdPreviewToMeshPhysicalTextureMap[parameterName];
      if (materialParameterMapName === undefined) {
        console.warn(
          `Unsupported material texture parameter '${parameterName}'.`
        );
        resolve();
        return;
      }
      if (mainMaterial[parameterName] && mainMaterial[parameterName].nodeIn) {
        const nodeIn = mainMaterial[parameterName].nodeIn;
        if (!nodeIn.resolvedPath) {
          console.warn("Texture node has no file!", nodeIn);
        }
        if (DEBUG.textures)
          console.log(
            "Assigning texture with resolved path",
            parameterName,
            nodeIn.resolvedPath
          );
        const textureFileName = nodeIn.resolvedPath?.replace("./", "");
        const channel = mainMaterial[parameterName].inputName;

        if (DEBUG.textures) {
          const matName = Object.keys(this._nodes).find(
            (key) => this._nodes[key] === mainMaterial
          );
          console.log(
            `Setting texture '${materialParameterMapName}' (${textureFileName}) of material '${matName}' with channel '${channel}'`
          );
        }

        this._interface.registry
          .getTexture(textureFileName)
          .then((texture) => {
            if (!this._material) {
              console.error(
                "Material not set when trying to assign texture, this is likely a bug"
              );
              resolve();
            }
            // console.log("getTexture", texture, nodeIn);
            if (materialParameterMapName === "alphaMap") {
              // If this is an opacity map, check if it's using the alpha channel of the diffuse map.
              // If so, simply change the format of that diffuse map to RGBA and make the material transparent.
              // If not, we need to copy the alpha channel into a new texture's green channel, because that's what Three.js
              // expects for alpha maps (not supported at the moment).
              // NOTE that this only works if diffuse maps are always set before opacity maps, so the order of
              // 'assingTexture' calls for a material matters.
              if (
                nodeIn.file === mainMaterial.diffuseColor?.nodeIn?.file &&
                channel === "a"
              ) {
                this._material.map.format = RGBAFormat;
              } else {
                // TODO: Extract the alpha channel into a new RGB texture.
                console.warn(
                  "Separate alpha channel is currently not supported.",
                  nodeIn.file,
                  mainMaterial.diffuseColor?.nodeIn?.file,
                  channel
                );
              }
              if (!this._material.alphaClip) this._material.transparent = true;

              this._material.needsUpdate = true;
              resolve();
              return;
            } else if (materialParameterMapName === "metalnessMap") {
              this._material.metalness = 1.0;
            } else if (materialParameterMapName === "roughnessMap") {
              this._material.roughness = 1.0;
            } else if (materialParameterMapName === "emissiveMap") {
              this._material.emissive = new Color(0xffffff);
            } else if (!HydraMaterial.channelMap[channel]) {
              console.warn(`Unsupported texture channel '${channel}'!`);
              resolve();
              return;
            }
            // TODO need to apply bias/scale to the texture in some cases.
            // May be able to extract that for metalness/roughness/opacity/normalScale

            // Clone texture and set the correct format.
            const clonedTexture = texture.clone();
            let targetSwizzle = "rgba";

            if (materialParameterMapName == "roughnessMap" && channel != "g") {
              targetSwizzle = "0" + channel + "11";
            }
            if (materialParameterMapName == "metalnessMap" && channel != "b") {
              targetSwizzle = "01" + channel + "1";
            }
            if (materialParameterMapName == "occlusionMap" && channel != "r") {
              targetSwizzle = channel + "111";
            }
            if (materialParameterMapName == "opacityMap" && channel != "a") {
              targetSwizzle = channel + channel + channel + channel;
            }

            clonedTexture.colorSpace =
              HydraMaterial.usdPreviewToColorSpaceMap[parameterName] ||
              LinearSRGBColorSpace;

            if (targetSwizzle != "rgba") {
              clonedTexture.image = HydraMaterial._swizzleImageChannels(
                clonedTexture.image,
                targetSwizzle
              );
            }

            clonedTexture.format = HydraMaterial.channelMap[channel];
            clonedTexture.needsUpdate = true;
            if (nodeIn.st && nodeIn.st.nodeIn) {
              const uvData = nodeIn.st.nodeIn;

              // TODO this is messed up but works for scale and translation, not really for rotation.
              // Refer to https://github.com/mrdoob/three.js/blob/e5426b0514a1347d7aafca69aa34117503c1be88/examples/jsm/exporters/USDZExporter.js#L461
              // (which is also not perfect but close)

              const rotation = uvData.rotation
                ? (uvData.rotation / 180) * Math.PI
                : 0;
              const offset = uvData.translation
                ? new Vector2(uvData.translation[0], uvData.translation[1])
                : new Vector2(0, 0);
              const repeat = uvData.scale
                ? new Vector2(uvData.scale[0], uvData.scale[1])
                : new Vector2(1, 1);

              const xRotationOffset = Math.sin(rotation);
              const yRotationOffset = Math.cos(rotation);
              offset.y = offset.y - (1 - yRotationOffset) * repeat.y;
              offset.x = offset.x - xRotationOffset * repeat.x;

              clonedTexture.repeat.set(repeat.x, repeat.y);
              clonedTexture.offset.set(offset.x, offset.y);
              clonedTexture.rotation = rotation;
            }

            // TODO use nodeIn.wrapS and wrapT and map to THREE
            clonedTexture.wrapS = this.convertWrap(nodeIn.wrapS);
            clonedTexture.wrapT = this.convertWrap(nodeIn.wrapT);
            if (DEBUG.textures)
              console.log(
                "Setting texture " + materialParameterMapName + " to",
                clonedTexture
              );
            this._material[materialParameterMapName] = clonedTexture;
            this._material.needsUpdate = true;

            if (DEBUG.textures) {
              const matName = Object.keys(this._nodes).find(
                (key) => this._nodes[key] === mainMaterial
              );
              console.log(
                "RESOLVED TEXTURE",
                clonedTexture.name,
                matName,
                parameterName
              );
            }
            resolve();
            return;
          })
          .catch((err) => {
            console.warn("Error when loading texture", err);
            resolve();
            return;
          });
      } else {
        this._material[materialParameterMapName] = undefined;
        resolve();
        return;
      }
    });
  }

  // from https://github.com/mrdoob/three.js/blob/dev/src/math/ColorManagement.js
  static SRGBToLinear(c) {
    return c < 0.04045
      ? c * 0.0773993808
      : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
  }

  static LinearToSRGB(c) {
    return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
  }

  /**
   * Swizzle image channels (e.g. move red channel to green channel)
   * @param {*} image three.js image
   * @param {string} swizzle For example, "rgga". Must have max. 4 components. Can contain 0 and 1, e.g. "rgba1" is valid.
   * @returns three.js image
   */
  static _swizzleImageChannels(image, swizzle) {
    if (
      (typeof HTMLImageElement !== "undefined" &&
        image instanceof HTMLImageElement) ||
      (typeof HTMLCanvasElement !== "undefined" &&
        image instanceof HTMLCanvasElement) ||
      (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
    ) {
      const canvas = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "canvas"
      );

      canvas.width = image.width;
      canvas.height = image.height;

      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, image.width, image.height);

      const imageData = context.getImageData(0, 0, image.width, image.height);
      const data = imageData.data;

      // console.log(data);

      const swizzleToIndex = {
        r: 0,
        g: 1,
        b: 2,
        a: 3,
        x: 0,
        y: 1,
        z: 2,
        w: 3,
        0: 4, // set to 0
        1: 5, // set to 1
        "-": -1, // passthrough
      };
      const arrayAccessBySwizzle = [4, 4, 4, 4]; // empty value if nothing defined in the swizzle pattern
      for (let i = 0; i < swizzle.length; i++) {
        arrayAccessBySwizzle[i] = swizzleToIndex[swizzle[i]];
      }

      const dataEntry = data.slice(0);
      for (let i = 0; i < data.length; i += 4) {
        dataEntry[0] = data[i];
        dataEntry[1] = data[i + 1];
        dataEntry[2] = data[i + 2];
        dataEntry[3] = data[i + 3];
        dataEntry[4] = 0; // empty value
        dataEntry[5] = 1;

        const rAccess = arrayAccessBySwizzle[0];
        const gAccess = arrayAccessBySwizzle[1];
        const bAccess = arrayAccessBySwizzle[2];
        const aAccess = arrayAccessBySwizzle[3];

        if (rAccess !== -1) data[i] = dataEntry[rAccess];
        if (gAccess !== -1) data[i + 1] = dataEntry[gAccess];
        if (bAccess !== -1) data[i + 2] = dataEntry[bAccess];
        if (aAccess !== -1) data[i + 3] = dataEntry[aAccess];
      }

      context.putImageData(imageData, 0, 0);
      return canvas;
    } else if (image.data) {
      const data = image.data.slice(0);

      for (let i = 0; i < data.length; i++) {
        if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
          data[i] = Math.floor(this.SRGBToLinear(data[i] / 255) * 255);
        } else {
          // assuming float
          data[i] = this.SRGBToLinear(data[i]);
        }
      }

      return {
        data: data,
        width: image.width,
        height: image.height,
      };
    } else {
      console.warn(
        "ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."
      );
      return image;
    }
  }

  assignProperty(mainMaterial, parameterName) {
    const materialParameterName =
      HydraMaterial.usdPreviewToMeshPhysicalMap[parameterName];
    if (materialParameterName === undefined) {
      console.warn(`Unsupported material parameter '${parameterName}'.`);
      return;
    }
    if (
      mainMaterial[parameterName] !== undefined &&
      !mainMaterial[parameterName].nodeIn
    ) {
      // console.log(`Assigning property ${parameterName}: ${mainMaterial[parameterName]}`);
      if (Array.isArray(mainMaterial[parameterName])) {
        this._material[materialParameterName] = new Color().fromArray(
          mainMaterial[parameterName]
        );
      } else {
        this._material[materialParameterName] = mainMaterial[parameterName];
        if (
          materialParameterName === "opacity" &&
          mainMaterial[parameterName] < 1.0
        ) {
          this._material.transparent = true;
        }
        if (
          parameterName == "opacityThreshold" &&
          mainMaterial[parameterName] > 0.0
        ) {
          this._material.transparent = false;
          this._material.alphaClip = true;
        }
      }
    }
  }

  async updateFinished(type, relationships) {
    // Wire up node relationships
    for (const relationship of relationships) {
      relationship.nodeIn = this._nodes[relationship.inputId];
      relationship.nodeOut = this._nodes[relationship.outputId];
      relationship.nodeIn[relationship.inputName] = relationship;
      relationship.nodeOut[relationship.outputName] = relationship;
    }

    if (DEBUG.materials) console.log("Finalizing Material:", this._id);

    // Find the main material node
    const mainMaterialNode = Object.values(this._nodes).find(
      (node) => node.diffuseColor
    );

    if (!mainMaterialNode || DISABLE_MATERIALS) {
      this._material = defaultMaterial;
      return;
    }

    // Create new material (TODO: avoid recreating on every update)
    this._material = new MeshPhysicalMaterial({ side: DoubleSide });
    this._material.name = this._id.split("/").pop() || this._id;

    // Check for texture maps
    const haveRoughnessMap = !!mainMaterialNode.roughness?.nodeIn;
    const haveMetalnessMap = !!mainMaterialNode.metallic?.nodeIn;
    const haveOcclusionMap = !!mainMaterialNode.occlusion?.nodeIn;

    if (DEBUG.materials) {
      console.log("Creating Material:", this._id, {
        haveRoughnessMap,
        haveMetalnessMap,
        haveOcclusionMap,
      });
    }

    const texturePromises = Object.keys(
      HydraMaterial.usdPreviewToMeshPhysicalTextureMap
    ).map((key) => this.assignTexture(mainMaterialNode, key));
    await Promise.all(texturePromises);

    // Sanitize metallic/roughness maps for glTF compatibility
    if (haveRoughnessMap && !haveMetalnessMap) {
      this._material.metalnessMap = this._material.roughnessMap;
      if (this._material.metalnessMap) {
        this._material.metalnessMap.needsUpdate = true;
      } else {
        console.error("Roughness map loading failed");
      }
    } else if (haveMetalnessMap && !haveRoughnessMap) {
      this._material.roughnessMap = this._material.metalnessMap;
      if (this._material.roughnessMap) {
        this._material.roughnessMap.needsUpdate = true;
      } else {
        console.error("Metalness map loading failed");
      }
    }

    // Assign material properties
    Object.keys(HydraMaterial.usdPreviewToMeshPhysicalMap).forEach((key) =>
      this.assignProperty(mainMaterialNode, key)
    );

    if (DEBUG.materials) {
      console.log(
        `Material "${this._material.name}"`,
        mainMaterialNode,
        this._material
      );
    }
  }
}
