import {
  Vector3,
  Box3,
  PerspectiveCamera,
  Scene,
  Group,
  WebGLRenderer,
  SRGBColorSpace,
  NeutralToneMapping,
  VSMShadowMap,
  PMREMGenerator,
  EquirectangularReflectionMapping,
} from "three";
import { ThreeRenderDelegateInterface } from "./hydra/ThreeJsRenderDelegate.js";
import {
  shouldInclude,
  isUsdFile,
  getFileFromHandle,
  parseFilePath,
  safeCall,
  getEntryFile,
} from "./usdUtils.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import "./bindings/emHdBindings.js";

const getUsdModule = globalThis["NEEDLE:USD:GET"];

const SKIP_DIRS = [
  ".git",
  "node_modules",
  "__pycache__",
  ".vscode",
  ".idea",
  "build",
  "dist",
  ".next",
];
const SKIP_FILES = [
  ".gitignore",
  "README.md",
  "LICENSE",
  "package.json",
  ".DS_Store",
  ".env",
];
const SYS_DIRS = ["/dev/", "/proc/", "/home/", "/tmp/", "/usd/"];

export function init(options = { container: null, hdrPath: null }) {
  return new Promise((resolveInit) => {
    if (!options?.container) {
      throw new Error("init: options.container is required");
    }
    options.hdrPath ||= "/usd-viewer/environments/neutral.hdr";

    let handle = null;

    const run = () => {
      let USD;
      let resolveUsdReady;
      const usdReady = new Promise((resolve) => {
        resolveUsdReady = resolve;
      });

      // Install a lightweight fetch rewrite so requests to "/host/..." are
      // mapped to the current asset base directory of the last loaded URL
      function installFetchRewrite() {
        if (window.__usdFetchRewritten) return;
        const origFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          try {
            const url = typeof input === "string" ? input : input?.url;
            if (url?.startsWith("/host/") && window.__usdAssetBase) {
              const mapped = window.__usdAssetBase + url.substring(6);
              return origFetch(mapped, init);
            }
          } catch {}
          return origFetch(input, init);
        };
        window.__usdFetchRewritten = true;
      }

      let currentDisplayFilename = "";
      const initPromise = setup();

      console.log("Loading USD Module...");
      try {
        Promise.all([
          getUsdModule({
            mainScriptUrlOrBlob: "/usd-viewer/bindings/emHdBindings.js",
            locateFile: (file) => {
              return "/usd-viewer/bindings/" + file;
            },
            // Suppress noisy OpenUSD discovery warnings that don't affect functionality
            printErr: (text) => {
              try {
                const s = String(text || "");
                if (
                  s.includes("_FindAndInstantiateDiscoveryPlugins") ||
                  s.includes("/ndr/registry.cpp") ||
                  s.includes("Failed verification: ' pluginFactory '") ||
                  // Harmless when loading packaged USDZ read-only; USD attempts to save are blocked
                  s.includes("_WriteToFile") ||
                  s.includes("/sdf/layer.cpp") ||
                  s.includes(
                    "writing package usdz layer is not allowed through this API"
                  )
                ) {
                  return;
                }
              } catch {}
              // Fallback to standard error output for everything else
              try {
                console.error(text);
              } catch {}
            },
          }),
          initPromise,
        ]).then(async ([Usd]) => {
          USD = Usd;
          if (resolveUsdReady) resolveUsdReady(USD);
          animate();
        });
      } catch (error) {
        if (error.toString().indexOf("SharedArrayBuffer") >= 0) {
          console.log(
            error,
            "Your current browser doesn't support SharedArrayBuffer which is required for USD."
          );
        } else {
          console.log(
            "Your current browser doesn't support USD-for-web. Error during initialization: " +
              error
          );
        }
      }

      let timeout = 40;
      let endTimeCode = 1;
      let ready = false;

      const usdzExportBtn = document.getElementById("export-usdz");
      if (usdzExportBtn)
        usdzExportBtn.addEventListener("click", () => {
          alert("usdz");
        });

      const gltfExportBtn = document.getElementById("export-gltf");
      if (gltfExportBtn)
        gltfExportBtn.addEventListener("click", (evt) => {
          const exporter = new GLTFExporter();
          console.log("EXPORTING GLTF", window.usdRoot);
          exporter.parse(
            window.usdRoot,
            function (gltf) {
              const blob = new Blob([gltf], {
                type: "application/octet-stream",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              let filename = currentDisplayFilename;
              // strip extension, strip path
              filename =
                filename.split("/").pop()?.split(".")[0].split("?")[0] ||
                "export";
              a.download = filename + ".glb";
              a.click();
              URL.revokeObjectURL(url);
            },
            function (error) {
              console.error(error);
            },
            {
              binary: true,
              // not possible right now since USD controls animation bindings,
              // it's not a three.js clip
              animations: [
                // window.usdRoot.animations[0]
              ],
            }
          );
          evt.preventDefault();
        });

      function getAllLoadedFiles() {
        const filePaths = [];

        getAllLoadedFilePaths("/", filePaths);

        return filePaths;
      }

      function getAllLoadedFilePaths(currentPath, paths) {
        const files = USD.FS_readdir(currentPath);
        for (const file of files) {
          if (file === "." || file === "..") continue;
          const newPath = currentPath + file + "/";
          const data = USD.FS_analyzePath(currentPath + file + "/");
          if (data.object.node_ops.readdir) {
            if (!SYS_DIRS.includes(newPath))
              getAllLoadedFilePaths(newPath, paths);
          } else {
            paths.push(data.path);
          }
        }
      }

      // safeCall imported

      function clearStage() {
        if (!USD) {
          console.warn("USD not ready; skipping clearStage.");
          return;
        }
        // Try to dispose the driver/stage first to avoid any layer save attempts
        if (!safeCall(window.driver, "Dispose")) {
          safeCall(window.driver, "Destroy");
        }
        // Clear the rendered scene graph before touching the virtual FS
        safeCall(window.usdRoot, "clear");

        // Then unlink files from the in-memory FS, but keep .usdz packages to
        // avoid triggering writes to packaged layers
        const allFilePaths = getAllLoadedFiles();
        for (const file of allFilePaths) {
          if (String(file).toLowerCase().endsWith(".usdz")) {
            continue;
          }
          USD.FS_unlink(file, true);
        }
      }

      function addPath(root, path) {
        const files = USD.FS_readdir(path);
        for (const file of files) {
          if (file === "." || file === "..") continue;
          const newPath = path + file + "/";
          const data = USD.FS_analyzePath(path + file + "/");
          if (data.object.node_ops.readdir) {
            if (!SYS_DIRS.includes(newPath)) {
              root[file] = {};
              addPath(root[file], newPath);
            }
          } else {
            root[file] = data;
          }
        }
      }

      async function loadUsdFile(directory, filename, path, isRootFile = true) {
        currentDisplayFilename = filename;
        ready = false;

        // should be loaded last
        if (!isRootFile) return;

        let driver = null;
        const delegateConfig = {
          usdRoot: window.usdRoot,
          paths: [],
          driver: () => driver,
        };

        const renderInterface = (window.renderInterface =
          new ThreeRenderDelegateInterface(delegateConfig));
        driver = new USD.HdWebSyncDriver(renderInterface, path);
        if (driver instanceof Promise) {
          driver = await driver;
        }
        window.driver = driver;
        window.driver.Draw();

        let stage = window.driver.GetStage();
        if (stage instanceof Promise) {
          stage = await stage;
          stage = window.driver.GetStage();
        }
        window.usdStage = stage;
        if (stage.GetEndTimeCode) {
          endTimeCode = stage.GetEndTimeCode();
          timeout = 1000 / stage.GetTimeCodesPerSecond();
        }

        // if up axis is z, rotate, otherwise make sure rotation is 0, in case we rotated in the past and need to undo it
        window.usdRoot.rotation.x =
          String.fromCharCode(stage.GetUpAxis()) === "z" ? -Math.PI / 2 : 0;

        fitCameraToSelection(window.camera, window._controls, [window.usdRoot]);
        ready = true;

        const root = {};
        addPath(root, "/");
      }

      // from https://discourse.threejs.org/t/camera-zoom-to-fit-object/936/24
      function fitCameraToSelection(
        camera,
        controls,
        selection,
        fitOffset = 1.5
      ) {
        const size = new Vector3();
        const center = new Vector3();
        const box = new Box3();

        box.makeEmpty();
        for (const object of selection) {
          box.expandByObject(object);
        }

        box.getSize(size);
        box.getCenter(center);

        if (
          Number.isNaN(size.x) ||
          Number.isNaN(size.y) ||
          Number.isNaN(size.z) ||
          Number.isNaN(center.x) ||
          Number.isNaN(center.y) ||
          Number.isNaN(center.z)
        ) {
          console.warn(
            "Fit Camera failed: NaN values found, some objects may not have any mesh data.",
            selection,
            size
          );
          if (controls) controls.update();
          return;
        }

        if (!controls) {
          console.warn(
            "No camera controls object found, something went wrong."
          );
          return;
        }

        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance =
          maxSize / (2 * Math.atan((Math.PI * camera.fov) / 360));
        const fitWidthDistance = fitHeightDistance / camera.aspect;
        const distance =
          fitOffset * Math.max(fitHeightDistance, fitWidthDistance);

        if (distance == 0) {
          console.warn(
            "Fit Camera failed: distance is 0, some objects may not have any mesh data."
          );
          return;
        }

        camera.position.z = 7;
        camera.position.y = 7;
        camera.position.x = 0;

        const direction = controls.target
          .clone()
          .sub(camera.position)
          .normalize()
          .multiplyScalar(distance);

        controls.maxDistance = distance * 10;
        controls.target.copy(center);

        camera.near = distance / 100;
        camera.far = distance * 100;

        camera.updateProjectionMatrix();

        camera.position.copy(controls.target).sub(direction);
        controls.update();
      }

      async function setup() {
        const camera = (window.camera = new PerspectiveCamera(
          27,
          window.innerWidth / window.innerHeight,
          1,
          3500
        ));
        camera.position.z = 7;
        camera.position.y = 7;
        camera.position.x = 0;

        const scene = (window.scene = new Scene());

        const usdRoot = (window.usdRoot = new Group());
        usdRoot.name = "USD Root";
        scene.add(usdRoot);

        const renderer = (window.renderer = new WebGLRenderer({
          antialias: true,
          alpha: true,
        }));
        renderer.setPixelRatio(window.devicePixelRatio);

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = NeutralToneMapping;
        renderer.shadowMap.enabled = false;
        renderer.shadowMap.type = VSMShadowMap;
        renderer.setClearColor(0x000000, 0); // the default

        const envMapPromise = new Promise((resolve) => {
          const pmremGenerator = new PMREMGenerator(renderer);
          pmremGenerator.compileCubemapShader();

          new RGBELoader().load(
            options.hdrPath,
            (texture) => {
              const hdrRenderTarget =
                pmremGenerator.fromEquirectangular(texture);

              texture.mapping = EquirectangularReflectionMapping;
              texture.needsUpdate = true;
              scene.environment = hdrRenderTarget.texture;
              resolve();
            },
            undefined,
            (err) => {
              console.error(
                "An error occurred loading the HDR environment map.",
                err
              );
              resolve();
            }
          );
        });

        options.container.appendChild(renderer.domElement);
        const controls = (window._controls = new OrbitControls(
          camera,
          renderer.domElement
        ));
        controls.enableDamping = true;
        controls.dampingFactor = 0.2;
        controls.update();

        window.addEventListener("resize", onWindowResize);

        render();
        return envMapPromise;
      }

      // Optional: pause helper removed to avoid global DOM coupling

      async function animate() {
        window._controls.update();
        let secs = new Date().getTime() / 1000;
        await new Promise((resolve) => setTimeout(resolve, 10));
        const time = (secs * (1000 / timeout)) % endTimeCode;
        if (
          window.driver &&
          window.driver.SetTime &&
          window.driver.Draw &&
          ready
        ) {
          window.driver.SetTime(time);
          window.driver.Draw();
          render();
        }
        requestAnimationFrame(animate.bind(null, timeout, endTimeCode));
      }

      function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }

      function render() {
        // const time = Date.now() * 0.001;
        if (window.renderer.render && window.scene) {
          window.renderer.render(window.scene, window.camera);
        }
      }

      // getFileFromHandle imported

      // parseFilePath imported

      async function loadFile(
        fileOrHandle,
        isRootFile = true,
        fullPath = undefined
      ) {
        try {
          const file = await getFileFromHandle(fileOrHandle);
          const { fileName, directory } = parseFilePath(fullPath, file.name);

          const reader = new FileReader();
          const loadingPromise = new Promise((resolve, reject) => {
            reader.onloadend = resolve;
            reader.onerror = reject;
          });

          reader.onload = async function (event) {
            // Ensure USD module is initialized before filesystem operations
            if (!USD) await usdReady;

            USD.FS_createPath("", directory, true, true);
            // Mount file as read-only to prevent USD from attempting write-backs to packages
            USD.FS_createDataFile(
              directory,
              fileName,
              new Uint8Array(event.target.result),
              true /* canRead */,
              false /* canWrite */,
              true /* canOwn */
            );

            loadUsdFile(directory, fileName, fullPath, isRootFile);
          };

          reader.readAsArrayBuffer(file);
          await loadingPromise;
        } catch (ex) {
          console.warn("Error loading file", fileOrHandle, ex);
        }
      }

      // isUsdFile imported

      function testAndLoadFile(file) {
        if (isUsdFile(file.name)) {
          clearStage();
          loadFile(file);
        }
      }

      /**
       * @param {FileSystemDirectoryEntry} directory
       */
      async function readDirectory(directory) {
        let entries = [];

        let getAllDirectoryEntries = async (dirReader) => {
          let entries = [];
          let readEntries = async () => {
            let result = await new Promise((resolve, reject) =>
              dirReader.readEntries(resolve, reject)
            );
            if (result.length === 0) return entries;
            else return entries.concat(result, await readEntries());
          };
          return await readEntries();
        };

        /**
         * @param {FileSystemDirectoryReader} dirReader
         * @param {FileSystemDirectoryEntry} directory
         * @returns {Promise<number>}
         */
        let getEntries = async (directory) => {
          let dirReader = directory.createReader();
          await new Promise(async (resolve) => {
            // Call the reader.readEntries() until no more results are returned.

            const results = await getAllDirectoryEntries(dirReader);

            if (results.length) {
              // entries = entries.concat(results);
              for (let entry of results) {
                if (entry.isDirectory) {
                  const foundFiles = await getEntries(entry);
                  if (foundFiles === 100)
                    console.warn(
                      "Found more than 100 files in directory",
                      entry
                    );
                } else {
                  entries.push(entry);
                }
              }
            }
            resolve(results.length);
          });
        };

        await getEntries(directory);
        return entries;
      }

      /**
       * @param {FileSystemEntry[]} entries
       */
      async function handleFilesystemEntries(entries) {
        const allFiles = [];

        for (let entry of entries) {
          if (entry.isFile) {
            if (shouldInclude(entry.name)) allFiles.push(entry);
          } else if (entry.isDirectory) {
            if (SKIP_DIRS.includes(entry.name)) continue;
            const files = await readDirectory(entry);
            allFiles.push(...files.filter((file) => shouldInclude(file.name)));
          }
        }

        // clear current set of files
        clearStage();

        // Find root file candidates
        const usdFiles = allFiles.filter((file) => isUsdFile(file.name));
        const usdaFiles = usdFiles.filter((file) =>
          file.name.endsWith(".usda")
        );

        // Prefer .usda files, otherwise use first USD file
        let rootFile = usdaFiles[0] || usdFiles[0];

        if (rootFile) {
          allFiles.splice(allFiles.indexOf(rootFile), 1);
        } else {
          console.warn("No USD file found");
          return;
        }

        const getFile = getEntryFile;

        // Mount all non-root files concurrently; order doesn't matter as we load the root last

        // Load all non-root files into memory
        const loadPromises = allFiles.map(async (file) => {
          const fileObj = await getFile(file);
          if (fileObj) await loadFile(fileObj, false, file.fullPath);
        });
        await Promise.all(loadPromises);

        // Load the root file last
        if (rootFile) {
          if (!isUsdFile(rootFile.name)) {
            console.error("Not a supported file format:", rootFile.name);
          } else {
            const rootFileObj = await getFile(rootFile);
            if (rootFileObj) loadFile(rootFileObj, true, rootFile.fullPath);
          }
        }
      }

      /**
       * @param {DataTransfer} dataTransfer
       */
      function processDataTransfer(dataTransfer) {
        if (dataTransfer.items) {
          /** @type {FileSystemEntry[]} */
          const allEntries = [];

          let haveGetAsEntry = false;
          if (dataTransfer.items.length > 0)
            haveGetAsEntry =
              "getAsEntry" in dataTransfer.items[0] ||
              "webkitGetAsEntry" in dataTransfer.items[0];

          if (haveGetAsEntry) {
            for (const item of dataTransfer.items) {
              /** @type {FileSystemEntry} */
              const entry =
                "getAsEntry" in item
                  ? item.getAsEntry()
                  : item.webkitGetAsEntry();
              allEntries.push(entry);
            }
            handleFilesystemEntries(allEntries);
            return;
          }

          for (const item of dataTransfer.items) {
            // API when there's no "getAsEntry" support
            console.log(item.kind, item);
            if (item.kind === "file") {
              var file = item.getAsFile();
              testAndLoadFile(file);
            }
            // could also be a directory
            else if (item.kind === "directory") {
              var dirReader = item.createReader();
              dirReader.readEntries(function (entries) {
                for (var i = 0; i < entries.length; i++) {
                  console.log(entries[i].name);
                  var entry = entries[i];
                  if (entry.isFile) {
                    entry.file(function (file) {
                      testAndLoadFile(file);
                    });
                  }
                }
              });
            }
          }
        } else {
          for (const file of dataTransfer.files) {
            testAndLoadFile(file);
          }
        }
      }

      // Provide a minimal imperative API to the host (capturing the local scope)
      handle = {
        // Load a USD file from a URL
        loadFromURL: async (url) => {
          try {
            if (!USD) await usdReady;
            clearStage();
            const parts = url.split("/");
            const fileNameOnly = parts[parts.length - 1];
            // For packaged usdz, mount read-only to avoid write attempts
            if (fileNameOnly.toLowerCase().endsWith(".usdz")) {
              const res = await fetch(url, { cache: "no-store" });
              if (!res.ok) throw new Error("Failed to fetch " + url);
              const buffer = await res.arrayBuffer();
              const mountDir = "/host/";
              USD.FS_createPath("", mountDir, true, true);
              // If a previous package exists at the same path, remove it now that the stage is cleared
              try {
                const existing = USD.FS_analyzePath(mountDir + fileNameOnly);
                if (existing?.exists) {
                  USD.FS_unlink(mountDir + fileNameOnly);
                }
              } catch {}
              USD.FS_createDataFile(
                mountDir,
                fileNameOnly,
                new Uint8Array(buffer),
                true /* canRead */,
                false /* canWrite */,
                true /* canOwn */
              );
              await loadUsdFile(
                mountDir,
                fileNameOnly,
                mountDir + fileNameOnly,
                true
              );
            } else {
              // For usd/usda/usdc, keep URL so relative asset paths resolve via HTTP
              try {
                const base = new URL(url, window.location.origin);
                // ensure base URL ends with '/'
                const baseDir = base.href.substring(
                  0,
                  base.href.lastIndexOf("/") + 1
                );
                window.__usdAssetBase = baseDir;
                installFetchRewrite();
              } catch {}
              await loadUsdFile(undefined, fileNameOnly, url, true);
            }
          } catch (e) {
            console.warn("loadFromURL error", e);
          }
        },
        // Load from array buffer entries mounted into the in-memory FS
        loadFromEntries: async (entries, primaryPath) => {
          try {
            if (!USD) await usdReady;
            clearStage();
            // Mount all entries first (order doesn't matter since we load the root explicitly last)
            const list = (entries || []).slice();
            for (const { path, buffer } of list) {
              const fileName = path.split("/").pop();
              const dir =
                path.slice(0, path.length - (fileName?.length || 0)) || "/";
              USD.FS_createPath("", dir, true, true);
              USD.FS_createDataFile(
                dir,
                fileName,
                new Uint8Array(buffer),
                true /* canRead */,
                false /* canWrite */,
                true /* canOwn */
              );
            }
            // Determine root
            let root = primaryPath;
            if (!root) {
              // Prefer .usda, else any USD
              root =
                list.find((e) => e.path.endsWith(".usda"))?.path ||
                list.find((e) => isUsdFile(e.path))?.path;
            }
            if (root) {
              const fileNameOnly = root.split("/").pop();
              const dir =
                root.slice(0, root.length - (fileNameOnly?.length || 0)) || "/";
              await loadUsdFile(dir, fileNameOnly, root, true);
            }
          } catch (e) {
            console.warn("loadFromEntries error", e);
          }
        },
        // Load from a DataTransfer (e.g., from a drag/drop event)
        loadFromDataTransfer: async (dataTransfer) => {
          try {
            if (!USD) await usdReady;
            processDataTransfer(dataTransfer);
          } catch (e) {
            console.warn("loadFromDataTransfer error", e);
          }
        },
        // Load directly from a FileList or array of File
        loadFromFiles: async (files) => {
          try {
            if (!USD) await usdReady;
            clearStage();
            const fileArray = Array.from(files);
            for (const file of fileArray) testAndLoadFile(file);
          } catch (e) {
            console.warn("loadFromFiles error", e);
          }
        },
        // Load from a map of virtual paths -> File, with an optional primary root file path
        loadFromFilesMap: async (filesMap, primaryPath) => {
          try {
            if (!USD) await usdReady;
            clearStage();
            const entries = Object.entries(filesMap).filter(([p]) => {
              const name = p.split("/").pop() || p;
              return (
                !SKIP_FILES.includes(name) &&
                !name.startsWith("._") &&
                shouldInclude(name)
              );
            });
            // Load all non-root files first
            for (const [fullPath, file] of entries) {
              if (primaryPath && fullPath === primaryPath) continue;
              await loadFile(file, false, fullPath);
            }
            // Then load the primary/root if provided, else try to detect
            if (primaryPath && filesMap[primaryPath]) {
              await loadFile(filesMap[primaryPath], true, primaryPath);
              return;
            }
            // Detect a reasonable root (prefer .usda)
            const usdaRoot = entries.find(([p]) => p.endsWith(".usda"));
            const anyUsdRoot = entries.find(([p]) => isUsdFile(p));
            const root = usdaRoot || anyUsdRoot;
            if (root) {
              await loadFile(root[1], true, root[0]);
            }
          } catch (e) {
            console.warn("loadFromFilesMap error", e);
          }
        },
        // Clear the current stage
        clear: () => {
          try {
            clearStage();
          } catch (e) {
            console.warn("clear error", e);
          }
        },
        // Dispose the viewer and remove listeners/canvas
        dispose: () => {
          try {
            window.removeEventListener("resize", onWindowResize);
            if (window.renderer && window.renderer.domElement) {
              if (options.container.contains(window.renderer.domElement)) {
                options.container.removeChild(window.renderer.domElement);
              }
              if (window.renderer.dispose) window.renderer.dispose();
            }
          } catch (e) {
            console.warn("dispose error", e);
          }
        },
      };
    };

    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          run();
          try {
            if (resolveInit) resolveInit(handle);
          } catch {}
        },
        { once: true }
      );
    } else {
      run();
      try {
        if (resolveInit) resolveInit(handle);
      } catch {}
    }
  });
}

// Auto-initialize when loaded as a module
let handle = null;

// Create container dynamically like MuJoCo does
const container = document.createElement("div");
document.body.appendChild(container);

function post(type, payload = {}) {
  try {
    parent.postMessage({ type, ...payload }, "*");
  } catch {}
}

async function bootstrap() {
  try {
    handle = await init({
      container,
      hdrPath: "/usd-viewer/environments/neutral.hdr",
    });
  } catch (e) {
    console.warn("[USD Iframe] init error", e);
  } finally {
    post("IFRAME_READY");
  }
}

// helper to load entries [{ path, buffer(ArrayBuffer) }, ...]
async function loadFromEntries(entries, primaryPath) {
  try {
    if (!handle?.loadFromEntries) return;
    await handle.loadFromEntries(entries, primaryPath);
  } catch (e) {
    console.warn("[USD Iframe] loadFromEntries error", e);
  }
}

window.addEventListener("message", async (evt) => {
  const data = evt.data;
  if (!data || typeof data !== "object") return;
  try {
    switch (data.type) {
      case "USD_LOAD_URL":
        post("USD_LOADING_START");
        await handle?.loadFromURL?.(data.url);
        post("USD_LOADED");
        break;
      case "USD_CLEAR":
        await handle?.clear?.();
        break;
      case "USD_LOAD_ENTRIES":
        post("USD_LOADING_START");
        await loadFromEntries(data.entries || [], data.primaryPath);
        post("USD_LOADED");
        break;
      default:
        break;
    }
  } catch (e) {
    console.warn("[USD Iframe] message error", e);
  }
});

bootstrap();
