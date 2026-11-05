import { TextureLoader } from "three";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";

const DEBUG_TEXTURES = false;

export class TextureRegistry {
  /**
   * @param {import('../../usd-viewer').threeJsRenderDelegateConfig} config
   */
  constructor(config) {
    this.config = config;
    this.allPaths = config.paths;
    this.textures = [];
    this.loader = new TextureLoader();
    this.tgaLoader = new TGALoader();
    this.exrLoader = new EXRLoader();

    // Determine base URL for external assets from globally provided asset base
    if (typeof window !== "undefined" && window.__usdAssetBase) {
      this.baseUrl = String(window.__usdAssetBase).replace(/\/$/, "");
    }
  }

  getTexture(resourcePath) {
    if (DEBUG_TEXTURES) console.log("get texture", resourcePath);

    if (this.textures[resourcePath]) return this.textures[resourcePath];
    if (!resourcePath) {
      return Promise.reject(
        new Error("Empty resource path for file: " + resourcePath)
      );
    }

    let textureResolve, textureReject;
    this.textures[resourcePath] = new Promise((resolve, reject) => {
      textureResolve = resolve;
      textureReject = reject;
    });

    // Extract file extension, handling USDZ-internal paths like "file.usdz[0/texture.jpg]"
    const extractExtension = (path) => {
      // Handle USDZ internal paths: extract extension from the inner path
      const usdzMatch = path.match(/\.usdz\[\d+\/.*\.(\w+)\]$/i);
      if (usdzMatch) return usdzMatch[1].toLowerCase();

      // Regular file path extension
      const match = path.match(/\.(\w+)(?:\])?$/i);
      return match ? match[1].toLowerCase() : null;
    };

    const ext = extractExtension(resourcePath);
    const typeMap = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      exr: "image/x-exr",
      tga: "image/tga",
    };

    const filetype = typeMap[ext];
    if (!filetype) {
      console.error("[USD] unknown filetype", resourcePath);
    }
    if (ext === "exr" || ext === "tga") {
      console.warn(
        `${ext.toUpperCase()} textures are not fully supported yet`,
        resourcePath
      );
    }

    this.config.driver().getFile(resourcePath, async (loadedFile) => {
      let loader = this.loader;
      if (filetype === "image/tga") loader = this.tgaLoader;
      else if (filetype === "image/x-exr") loader = this.exrLoader;

      const loadFromFile = (_loadedFile) => {
        if (DEBUG_TEXTURES)
          console.log("Loading file", resourcePath, "=>", !!_loadedFile);

        let url;
        if (_loadedFile) {
          url = URL.createObjectURL(
            new Blob([_loadedFile.slice(0)], { type: filetype })
          );
        } else if (this.baseUrl) {
          const networkPath = resourcePath
            .replace(/^\/+/, "")
            .replace(/^host\//, "");
          url = this.baseUrl + networkPath;
        } else {
          url = resourcePath;
        }

        loader.load(
          url,
          (texture) => {
            texture.name = resourcePath;
            textureResolve(texture);
          },
          undefined,
          textureReject
        );
      };

      if (!loadedFile && !this.baseUrl) {
        // Create stub texture for USDZ-internal paths to prevent errors
        if (resourcePath.includes(".usdz[")) {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, 1, 1);
          }
          const stubTexture = this.loader.load(canvas.toDataURL());
          stubTexture.name = resourcePath;
          textureResolve(stubTexture);
          return;
        }
        textureReject(new Error("Unknown file: " + resourcePath));
        return;
      }

      loadFromFile(loadedFile);
    });

    return this.textures[resourcePath];
  }
}
