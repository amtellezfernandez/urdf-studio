import {
  OPERATOR_CONTROL_TRANSPORT_TELEOP_CAPABILITY_REQUIRED_ROLE,
  OPERATOR_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT,
  OPERATOR_CONTROL_TRANSPORT_TELEOP_CAPABILITY_VERIFY_PATH,
} from "@/features/teleop/params/operatorTeleopParams";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toBoolean = (value: unknown, defaultValue: boolean): boolean =>
  typeof value === "boolean" ? value : defaultValue;

type OperatorControlTransportFieldName = {
  camelCase: string;
  snakeCase: string;
};

const readField = (
  value: Record<string, unknown>,
  fieldName: OperatorControlTransportFieldName,
): unknown =>
  Object.prototype.hasOwnProperty.call(value, fieldName.camelCase)
    ? value[fieldName.camelCase]
    : value[fieldName.snakeCase];

const readStringField = (
  value: Record<string, unknown>,
  fieldName: OperatorControlTransportFieldName,
): string => toTrimmedString(readField(value, fieldName));

const readBooleanField = (
  value: Record<string, unknown>,
  fieldName: OperatorControlTransportFieldName,
  defaultValue: boolean,
): boolean => toBoolean(readField(value, fieldName), defaultValue);

const CONTROL_TRANSPORT_FIELDS = {
  manifestPath: { camelCase: "manifestPath", snakeCase: "manifest_path" },
  statsPath: { camelCase: "statsPath", snakeCase: "stats_path" },
  webtransportUrl: {
    camelCase: "webtransportUrl",
    snakeCase: "webtransport_url",
  },
  nativeQuicAddress: {
    camelCase: "nativeQuicAddress",
    snakeCase: "native_quic_address",
  },
  nativeQuicAlpn: {
    camelCase: "nativeQuicAlpn",
    snakeCase: "native_quic_alpn",
  },
  sidecarReady: { camelCase: "sidecarReady", snakeCase: "sidecar_ready" },
  requiresLease: { camelCase: "requiresLease", snakeCase: "requires_lease" },
  requiresTeleopCapability: {
    camelCase: "requiresTeleopCapability",
    snakeCase: "requires_teleop_capability",
  },
  teleopCapabilityVerifyPath: {
    camelCase: "teleopCapabilityVerifyPath",
    snakeCase: "teleop_capability_verify_path",
  },
  teleopCapabilityRequiredRole: {
    camelCase: "teleopCapabilityRequiredRole",
    snakeCase: "teleop_capability_required_role",
  },
  teleopCapabilityTransport: {
    camelCase: "teleopCapabilityTransport",
    snakeCase: "teleop_capability_transport",
  },
} as const;

export type OperatorControlTransportDescriptor = {
  type: "teleop_sidecar";
  manifestPath: string;
  statsPath: string;
  webtransportUrl: string;
  nativeQuicAddress: string;
  nativeQuicAlpn: string;
  sidecarReady: boolean;
  requiresLease: boolean;
  requiresTeleopCapability: boolean;
  teleopCapabilityVerifyPath: string;
  teleopCapabilityRequiredRole: string;
  teleopCapabilityTransport: string;
};

export const normalizeOperatorControlTransportDescriptor = (
  value: unknown,
): OperatorControlTransportDescriptor | null => {
  if (!isRecord(value) || toTrimmedString(value.type) !== "teleop_sidecar") {
    return null;
  }

  const manifestPath = readStringField(value, CONTROL_TRANSPORT_FIELDS.manifestPath);
  const statsPath = readStringField(value, CONTROL_TRANSPORT_FIELDS.statsPath);
  const webtransportUrl = readStringField(
    value,
    CONTROL_TRANSPORT_FIELDS.webtransportUrl,
  );
  const nativeQuicAddress = readStringField(
    value,
    CONTROL_TRANSPORT_FIELDS.nativeQuicAddress,
  );
  const nativeQuicAlpn = readStringField(
    value,
    CONTROL_TRANSPORT_FIELDS.nativeQuicAlpn,
  );
  const sidecarReady = readBooleanField(
    value,
    CONTROL_TRANSPORT_FIELDS.sidecarReady,
    false,
  );

  if (
    !sidecarReady ||
    !manifestPath ||
    !statsPath ||
    !webtransportUrl ||
    !nativeQuicAddress ||
    !nativeQuicAlpn
  ) {
    return null;
  }

  return {
    type: "teleop_sidecar",
    manifestPath,
    statsPath,
    webtransportUrl,
    nativeQuicAddress,
    nativeQuicAlpn,
    sidecarReady,
    requiresLease: readBooleanField(
      value,
      CONTROL_TRANSPORT_FIELDS.requiresLease,
      true,
    ),
    requiresTeleopCapability: readBooleanField(
      value,
      CONTROL_TRANSPORT_FIELDS.requiresTeleopCapability,
      true,
    ),
    teleopCapabilityVerifyPath:
      readStringField(value, CONTROL_TRANSPORT_FIELDS.teleopCapabilityVerifyPath) ||
      OPERATOR_CONTROL_TRANSPORT_TELEOP_CAPABILITY_VERIFY_PATH,
    teleopCapabilityRequiredRole:
      readStringField(
        value,
        CONTROL_TRANSPORT_FIELDS.teleopCapabilityRequiredRole,
      ) || OPERATOR_CONTROL_TRANSPORT_TELEOP_CAPABILITY_REQUIRED_ROLE,
    teleopCapabilityTransport:
      readStringField(value, CONTROL_TRANSPORT_FIELDS.teleopCapabilityTransport) ||
      OPERATOR_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT,
  };
};
