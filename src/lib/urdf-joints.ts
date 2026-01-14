import type { URDFRobot } from "urdf-loader";

export type JointValueMap = Record<string, number>;

type ApplyJointValuesOptions = {
  filter?: boolean;
};

const buildNumericJointValues = (values: JointValueMap) => {
  const result: JointValueMap = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[name] = value;
    }
  }
  return result;
};

export const applyJointValues = (
  robot: URDFRobot | null,
  values: JointValueMap,
  options: ApplyJointValuesOptions = {}
) => {
  if (!robot) return;
  const payload = options.filter === false ? values : buildNumericJointValues(values);
  if (Object.keys(payload).length === 0) return;

  if (typeof robot.setJointValues === "function") {
    robot.setJointValues(payload);
    return;
  }

  if (typeof robot.setJointValue === "function") {
    for (const [name, value] of Object.entries(payload)) {
      robot.setJointValue(name, value);
    }
  }
};
