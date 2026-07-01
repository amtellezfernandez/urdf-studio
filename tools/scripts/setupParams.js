export const SETUP_NPM_INSTALL_FLAGS = ["--no-fund", "--audit=false", "--loglevel=error"];

export const PYTHON_ENV_DIRNAME = ".venv";
export const SIMULATOR_PYTHON_ENV_DIRNAME = ".venv-sim311";

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
    packages: ["genesis-world", "torch"],
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
    packages: ["mujoco", "mujoco-mjx", "jax"],
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
    pythonVersion: "3.11",
    packages: ["isaacsim"],
    importNames: ["isaacsim"],
    eulaEnv: "OMNI_KIT_ACCEPT_EULA",
    installNote:
      "Isaac Sim 5.x requires Python 3.11. Set OMNI_KIT_ACCEPT_EULA=YES only after you accept NVIDIA's Omniverse EULA.",
  },
  "isaac-lab": {
    label: "Isaac Lab",
    kind: "python",
    pythonVersion: "3.11",
    packages: ["isaacsim", "isaaclab"],
    importNames: ["isaaclab"],
    eulaEnv: "OMNI_KIT_ACCEPT_EULA",
    installNote:
      "Isaac Lab requires Python 3.11 and Isaac Sim. Set OMNI_KIT_ACCEPT_EULA=YES only after you accept NVIDIA's Omniverse EULA.",
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
    packages: ["pyrep"],
    importNames: ["pyrep"],
    installNote:
      "PyRep can be installed by pip, but a full CoppeliaSim installation is still required to run scenes.",
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
