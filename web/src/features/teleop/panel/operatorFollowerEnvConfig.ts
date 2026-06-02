const OPERATOR_FOLLOWER_ENV_CONFIG_FORMAT = {
  fallbackLabel: "Process env",
  robotEnvDirname: ".env.robots",
} as const;

export const formatOperatorFollowerEnvConfigRef = (
  configRef: string | null,
): string => {
  const trimmed = configRef?.trim();
  if (!trimmed) return OPERATOR_FOLLOWER_ENV_CONFIG_FORMAT.fallbackLabel;
  const pathParts = trimmed.replace(/\\/g, "/").split("/").filter(Boolean);
  const [fileName, parentName] = [...pathParts].reverse();
  if (!fileName) return trimmed;
  if (parentName === OPERATOR_FOLLOWER_ENV_CONFIG_FORMAT.robotEnvDirname) {
    return `${parentName}/${fileName}`;
  }
  return fileName;
};
