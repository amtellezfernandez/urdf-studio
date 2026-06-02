import type { OperatorTeleopProfile } from "@/features/teleop/profiles/operatorTeleopProfiles";
import { OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY } from "@/features/teleop/params/operatorTeleopParams";
import { resolveBrowserStorage } from "@/shared/lib/browserStorage";

export type OperatorDeviceRole = "leader" | "follower";
export type OperatorDeviceRoleAssignments = Record<string, OperatorDeviceRole>;

const resolveOperatorDeviceRoleAssignmentStorage = (): Storage | undefined => {
  return resolveBrowserStorage("local");
};

const toRoleLabel = (role: OperatorDeviceRole): string =>
  role === "leader" ? "leader" : "follower";

export const normalizeOperatorDeviceRoleKeys = (
  deviceKeys: readonly (string | null | undefined)[],
): string[] => [
  ...new Set(
    deviceKeys
      .map((deviceKey) => deviceKey?.trim() ?? "")
      .filter(Boolean),
  ),
];

export const buildOperatorProfileDeviceKey = ({
  providerId,
  profile,
}: {
  providerId: string | null | undefined;
  profile: OperatorTeleopProfile;
}): string => {
  if (profile.hardwareDeviceKey?.trim()) {
    return profile.hardwareDeviceKey.trim();
  }
  const parts = [
    "provider",
    providerId || "unknown",
    profile.adapterId || "adapter",
    profile.robotId || "robot",
  ];
  return parts.map((part) => part.trim()).filter(Boolean).join(":");
};

export const buildOperatorProfileDeviceKeys = ({
  providerId,
  profile,
}: {
  providerId: string | null | undefined;
  profile: OperatorTeleopProfile;
}): string[] =>
  normalizeOperatorDeviceRoleKeys([
    buildOperatorProfileDeviceKey({ providerId, profile }),
    ...(profile.hardwareDeviceKeys ?? []),
  ]);

export const readOperatorDeviceRoleAssignments = (
  storage: Storage | undefined = resolveOperatorDeviceRoleAssignmentStorage(),
): OperatorDeviceRoleAssignments => {
  if (!storage) return {};
  try {
    const rawValue = storage.getItem(OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY);
    if (!rawValue) return {};
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (
      typeof parsedValue !== "object" ||
      parsedValue === null ||
      Array.isArray(parsedValue)
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsedValue).filter(
        (entry): entry is [string, OperatorDeviceRole] =>
          Boolean(entry[0].trim()) &&
          (entry[1] === "leader" || entry[1] === "follower"),
      ),
    );
  } catch {
    return {};
  }
};

export const writeOperatorDeviceRoleAssignments = (
  assignments: OperatorDeviceRoleAssignments,
  storage: Storage | undefined = resolveOperatorDeviceRoleAssignmentStorage(),
): void => {
  if (!storage) return;
  try {
    storage.setItem(
      OPERATOR_DEVICE_ROLE_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify(assignments),
    );
  } catch {
    // Role persistence is advisory. Runtime role checks still run in memory.
  }
};

export const resolveOperatorDeviceRoleConflict = (
  assignments: OperatorDeviceRoleAssignments,
  deviceKey: string,
  requestedRole: OperatorDeviceRole,
): string | null => {
  const existingRole = assignments[deviceKey];
  if (!existingRole || existingRole === requestedRole) {
    return null;
  }
  return `Disconnect this device as ${toRoleLabel(existingRole)} before selecting it as ${toRoleLabel(requestedRole)}.`;
};

export const resolveOperatorDeviceRoleConflictForKeys = (
  assignments: OperatorDeviceRoleAssignments,
  deviceKeys: readonly (string | null | undefined)[],
  requestedRole: OperatorDeviceRole,
): string | null => {
  for (const deviceKey of normalizeOperatorDeviceRoleKeys(deviceKeys)) {
    const conflict = resolveOperatorDeviceRoleConflict(
      assignments,
      deviceKey,
      requestedRole,
    );
    if (conflict) return conflict;
  }
  return null;
};

export const assignOperatorDeviceRole = (
  assignments: OperatorDeviceRoleAssignments,
  deviceKey: string,
  role: OperatorDeviceRole,
):
  | { accepted: true; assignments: OperatorDeviceRoleAssignments; conflict: null }
  | { accepted: false; assignments: OperatorDeviceRoleAssignments; conflict: string } => {
  const normalizedDeviceKey = deviceKey.trim();
  if (!normalizedDeviceKey) {
    return {
      accepted: false,
      assignments,
      conflict: "Select a concrete hardware device before assigning a teleop role.",
    };
  }

  const conflict = resolveOperatorDeviceRoleConflict(
    assignments,
    normalizedDeviceKey,
    role,
  );
  if (conflict) {
    return { accepted: false, assignments, conflict };
  }

  return {
    accepted: true,
    assignments: { ...assignments, [normalizedDeviceKey]: role },
    conflict: null,
  };
};

export const assignOperatorDeviceRoleForKeys = (
  assignments: OperatorDeviceRoleAssignments,
  deviceKeys: readonly (string | null | undefined)[],
  role: OperatorDeviceRole,
):
  | { accepted: true; assignments: OperatorDeviceRoleAssignments; conflict: null }
  | { accepted: false; assignments: OperatorDeviceRoleAssignments; conflict: string } => {
  const normalizedDeviceKeys = normalizeOperatorDeviceRoleKeys(deviceKeys);
  if (normalizedDeviceKeys.length === 0) {
    return {
      accepted: false,
      assignments,
      conflict: "Select a concrete hardware device before assigning a teleop role.",
    };
  }

  const conflict = resolveOperatorDeviceRoleConflictForKeys(
    assignments,
    normalizedDeviceKeys,
    role,
  );
  if (conflict) {
    return { accepted: false, assignments, conflict };
  }

  return {
    accepted: true,
    assignments: {
      ...assignments,
      ...Object.fromEntries(
        normalizedDeviceKeys.map((deviceKey) => [deviceKey, role]),
      ),
    },
    conflict: null,
  };
};

export const releaseOperatorDeviceRole = (
  assignments: OperatorDeviceRoleAssignments,
  deviceKey: string,
  role?: OperatorDeviceRole,
): OperatorDeviceRoleAssignments => {
  const normalizedDeviceKey = deviceKey.trim();
  if (!normalizedDeviceKey) return assignments;
  if (role && assignments[normalizedDeviceKey] !== role) {
    return assignments;
  }
  const nextAssignments = { ...assignments };
  delete nextAssignments[normalizedDeviceKey];
  return nextAssignments;
};

export const releaseOperatorDeviceRoleForKeys = (
  assignments: OperatorDeviceRoleAssignments,
  deviceKeys: readonly (string | null | undefined)[],
  role?: OperatorDeviceRole,
): OperatorDeviceRoleAssignments =>
  normalizeOperatorDeviceRoleKeys(deviceKeys).reduce(
    (nextAssignments, deviceKey) =>
      releaseOperatorDeviceRole(nextAssignments, deviceKey, role),
    assignments,
  );
