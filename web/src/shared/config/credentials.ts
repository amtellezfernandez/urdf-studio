export type CredentialGate = {
  kind: "credential";
  enabled: boolean;
  unavailableSuffix: string;
  unavailableReason: string;
  disabledBadge: string;
  requiredCredentials: readonly string[];
};

export const withCredentialSuffix = (label: string, gate: CredentialGate): string =>
  gate.enabled || !gate.unavailableSuffix ? label : `${label} (${gate.unavailableSuffix})`;
