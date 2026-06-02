import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import {
  buildXacroExpandRequestPayload,
  createXacroFilePayloadFromBytes,
  isXacroSupportPath,
  parseXacroExpandResponsePayload,
  type XacroFilePayload,
  type XacroExpandResponsePayload,
} from "./urdfCore";

export const collectXacroSupportFiles = (files: FileList | File[]): File[] => {
  const list = Array.from(files);
  return list.filter((file) => {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return isXacroSupportPath(path);
  });
};

export const expandXacro = async (
  targetPath: string,
  files: File[],
  args?: Record<string, string>
): Promise<{ urdf: string; stderr?: string | null }> => {
  const payloadFiles: XacroFilePayload[] = [];

  for (const file of files) {
    const path =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (!path) continue;
    const buffer = await file.arrayBuffer();
    payloadFiles.push({
      ...createXacroFilePayloadFromBytes(path, new Uint8Array(buffer)),
    });
  }
  const payload = buildXacroExpandRequestPayload({
    targetPath,
    files: payloadFiles,
    args: args ?? {},
    useInorder: true,
  });

  const response = await guardedFetch(`${API_BASE_URL}/ilu/expand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, {
    requiredBackends: FEATURE_GATES.xacroExpansion.requiredBackends,
    context: "Xacro expansion",
  });

  if (!response.ok) {
    let message = "Failed to expand xacro file.";
    try {
      const payload = await response.json();
      if (payload?.detail) {
        message = payload.detail;
      }
    } catch {
      // Ignore parse errors.
    }
    throw new Error(message);
  }

  const data = (await response.json()) as XacroExpandResponsePayload;
  return parseXacroExpandResponsePayload(data);
};
