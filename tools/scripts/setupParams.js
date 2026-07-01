export const SETUP_NPM_INSTALL_FLAGS = ["--no-fund", "--audit=false", "--loglevel=error"];

export const PYTHON_ENV_DIRNAME = ".venv";

export const BACKEND_PYTHON_CORE_DEPENDENCIES = [
  "fastapi",
  "python-multipart",
  "uvicorn",
  "pydantic",
  "httpx",
  "pytest",
  "numpy==2.2.6",
  "yourdfpy",
];

export const SIMULATOR_OPTIONAL_RUNTIMES = {
  genesis: {
    label: "Genesis",
    kind: "python",
    packages: ["genesis-world"],
    importNames: ["genesis"],
  },
  mujoco: {
    label: "MuJoCo",
    kind: "python",
    packages: ["mujoco"],
    importNames: ["mujoco"],
  },
  pybullet: {
    label: "PyBullet",
    kind: "python",
    packages: ["pybullet"],
    importNames: ["pybullet"],
  },
  blender: {
    label: "Blender",
    kind: "external",
    packages: [],
    importNames: [],
    executableEnv: "URDF_STUDIO_BLENDER_PATH",
  },
};

export const SIMULATOR_OPTIONAL_RUNTIME_IDS = Object.freeze(
  Object.keys(SIMULATOR_OPTIONAL_RUNTIMES),
);
