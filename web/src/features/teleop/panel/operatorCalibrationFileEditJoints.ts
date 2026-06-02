const OPERATOR_CALIBRATION_FILE_EDIT_END_EFFECTOR_ONLY_TOKENS = [
  "gripper",
  "finger",
  "claw",
  "jaw",
  "hand",
] as const;

const normalizeOperatorCalibrationJointName = (jointName: string): string[] =>
  jointName
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const isOperatorCalibrationEndEffectorOnlyJoint = (jointName: string): boolean => {
  const tokens = normalizeOperatorCalibrationJointName(jointName);
  return OPERATOR_CALIBRATION_FILE_EDIT_END_EFFECTOR_ONLY_TOKENS.some((token) =>
    tokens.includes(token),
  );
};

export const resolveOperatorCalibrationFileEditGuidedJointNames = (
  jointNames: readonly string[],
): string[] => {
  const armJointNames = jointNames.filter(
    (jointName) => !isOperatorCalibrationEndEffectorOnlyJoint(jointName),
  );
  const endEffectorOnlyJointNames = jointNames.filter(
    isOperatorCalibrationEndEffectorOnlyJoint,
  );
  return [...armJointNames].reverse().concat([...endEffectorOnlyJointNames].reverse());
};
