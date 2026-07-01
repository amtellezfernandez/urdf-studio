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
        "Genesis, MuJoCo, PyBullet, and Blender adapters are exposed by the backend.",
        "Install optional simulator packages separately when you need a local target runtime.",
      ],
    },
  ];
}
