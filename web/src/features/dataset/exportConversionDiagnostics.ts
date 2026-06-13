export type RobotConversionDiagnosticsFormat = "mujoco" | "usd";

export type RobotConversionDiagnosticsSidecar = {
  filename: string;
  content: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArrayField = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const arrayField = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readNonNegativeStat = (stats: Record<string, unknown> | null, key: string): number => {
  const value = stats?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
};

export const buildRobotConversionDiagnosticsSidecar = (
  format: RobotConversionDiagnosticsFormat,
  filename: string,
  result: unknown
): RobotConversionDiagnosticsSidecar | null => {
  if (!isRecord(result)) {
    return null;
  }
  const warnings = stringArrayField(result.warnings);
  const diagnostics = arrayField(result.diagnostics);
  const stats = isRecord(result.stats) ? result.stats : null;
  const unsupportedMeshes = readNonNegativeStat(stats, "unsupportedMeshes");
  if (warnings.length === 0 && diagnostics.length === 0 && unsupportedMeshes === 0) {
    return null;
  }
  return {
    filename: `${filename}.diagnostics.json`,
    content: `${JSON.stringify(
      {
        schema: "urdf-studio.conversion-diagnostics.v1",
        format,
        sourceFile: filename,
        warnings,
        diagnostics,
        stats: stats ?? {},
      },
      null,
      2
    )}\n`,
  };
};
