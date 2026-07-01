const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes"]);

export function isTruthyEnvValue(value) {
  const normalizedValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TRUTHY_ENV_VALUES.has(normalizedValue);
}

export function buildSetupSummarySections({ pythonEnvDir = ".venv" } = {}) {
  return [
    {
      heading: "Run",
      lines: ["Start URDF Studio: npm run start"],
    },
    {
      heading: "Python",
      lines: [`Backend runtime: ${pythonEnvDir}`],
    },
    {
      heading: "Simulator Transfer",
      lines: [
        "RoboVerse-compatible targets are exposed by the backend.",
        "Openable now: Genesis, MuJoCo, MuJoCo MJX, Newton, PyBullet, Isaac Sim/Lab/Gym, SAPIEN, CoppeliaSim, Blender.",
        "All RoboVerse-compatible targets are runtime-gated instead of planned-only.",
        "Check installed targets: npm run simulator:status",
        "Install selected Python runtimes: npm run simulator:install -- mujoco pybullet",
        "Use URDF_STUDIO_PYTHON to point at an existing simulator Python environment.",
      ],
    },
  ];
}
