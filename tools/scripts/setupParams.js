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
  mjx: {
    label: "MuJoCo MJX",
    kind: "python",
    packages: ["mujoco", "jax"],
    importNames: ["mujoco.mjx", "jax"],
  },
  pybullet: {
    label: "PyBullet",
    kind: "python",
    packages: ["pybullet"],
    importNames: ["pybullet"],
  },
  "isaac-sim": {
    label: "Isaac Sim",
    kind: "python",
    packages: [],
    importNames: ["isaacsim"],
    installNote:
      "Install Isaac Sim with NVIDIA's supported workflow, then run with URDF_STUDIO_PYTHON pointing at that Python environment.",
  },
  "isaac-lab": {
    label: "Isaac Lab",
    kind: "python",
    packages: [],
    importNames: ["isaaclab"],
    installNote:
      "Install Isaac Lab on top of Isaac Sim with NVIDIA's supported workflow, then set URDF_STUDIO_PYTHON to its Python environment.",
  },
  "isaac-gym": {
    label: "Isaac Gym",
    kind: "python",
    packages: [],
    importNames: ["isaacgym"],
    installNote:
      "Install Isaac Gym from NVIDIA's legacy distribution, then set URDF_STUDIO_PYTHON to that Python environment.",
  },
  sapien: {
    label: "SAPIEN",
    kind: "python",
    packages: ["sapien"],
    importNames: ["sapien"],
  },
  coppeliasim: {
    label: "CoppeliaSim / PyRep",
    kind: "python",
    packages: [],
    importNames: ["pyrep"],
    installNote:
      "Install CoppeliaSim and PyRep, then set URDF_STUDIO_PYTHON to the PyRep Python environment.",
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
