export type RepeatedInertiaSymmetryCenterMode = "robot-center" | "root-mesh-center";

export const REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE: RepeatedInertiaSymmetryCenterMode =
  "robot-center";

export const REPEATED_INERTIA_SYMMETRY_CENTER_MODE_OPTIONS: Array<{
  description: string;
  label: string;
  value: RepeatedInertiaSymmetryCenterMode;
}> = [
  {
    value: "robot-center",
    label: "Robot center",
    description: "Use the symmetry root link origin as the center of the radial guide.",
  },
  {
    value: "root-mesh-center",
    label: "Root mesh center",
    description:
      "Use the symmetry root link geometry origin as the center of the radial guide.",
  },
];
