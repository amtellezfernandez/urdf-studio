export type StudioWheelRole = "drive" | "follower" | "unknown";
export type StudioWheelSide = "left" | "right" | "unknown";

export type StudioWheelJointFilterInput = {
  axisAlignmentWithUp: number;
  jointType: string;
  lowerLimit?: number;
  upperLimit?: number;
};

export const STUDIO_WHEEL_AXIS_ALIGNMENT_WITH_UP_MAX = 0.6;
export const STUDIO_WHEEL_REVOLUTE_SPAN_MIN_RAD = Math.PI;
export const STUDIO_WHEEL_NAME_TOKEN_REGEX = /(wheel|tire|rim|caster)/i;
const STUDIO_VENDOR_WHEEL_HINT_NAME_TOKEN_REGEX = /(wheel|tire|rim|caster)/i;
export const STUDIO_WHEEL_SIDE_INFERENCE_MIN_OFFSET_M = 0.01;

const isFiniteLimit = (value: number | undefined): value is number =>
  Number.isFinite(value);

export const shouldIncludeStudioWheelJoint = ({
  axisAlignmentWithUp,
  jointType,
  lowerLimit,
  upperLimit,
}: StudioWheelJointFilterInput): boolean => {
  if (!Number.isFinite(axisAlignmentWithUp)) return false;
  if (axisAlignmentWithUp > STUDIO_WHEEL_AXIS_ALIGNMENT_WITH_UP_MAX) {
    return false;
  }

  if (jointType !== "revolute") {
    return true;
  }

  if (!isFiniteLimit(lowerLimit) || !isFiniteLimit(upperLimit)) {
    return true;
  }

  if (upperLimit <= lowerLimit) {
    return true;
  }

  const span = upperLimit - lowerLimit;
  return span >= STUDIO_WHEEL_REVOLUTE_SPAN_MIN_RAD;
};

export const getStudioWheelRoleLabel = (role: StudioWheelRole): string =>
  role === "unknown" ? "idle" : role;

export const isStudioWheelLikeLabel = (label: string): boolean =>
  STUDIO_WHEEL_NAME_TOKEN_REGEX.test(label);

export const shouldDetectStudioWheelJointByHintOrLabel = ({
  jointName,
  label,
  driveJointHints,
}: {
  jointName: string;
  label: string;
  driveJointHints?: ReadonlySet<string>;
}): boolean => {
  if (driveJointHints?.has(jointName)) {
    return true;
  }
  return isStudioWheelLikeLabel(label);
};

export const inferStudioWheelSideFromLateralOffset = (
  lateralOffsetMeters: number,
  minOffsetMeters = STUDIO_WHEEL_SIDE_INFERENCE_MIN_OFFSET_M
): StudioWheelSide => {
  if (!Number.isFinite(lateralOffsetMeters)) {
    return "unknown";
  }
  if (Math.abs(lateralOffsetMeters) < Math.max(minOffsetMeters, 0)) {
    return "unknown";
  }
  return lateralOffsetMeters >= 0 ? "right" : "left";
};

export const STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME = "urdf_studio_auto_wheel_drive";
const STUDIO_AUTO_DRIVE_HINT_CONTROL_TYPE = "system";

export const toSortedUniqueJointNames = (jointNames: string[]): string[] =>
  Array.from(
    new Set(
      jointNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
    )
  ).sort((lhs, rhs) => lhs.localeCompare(rhs));

const addAttrValuesToSet = (
  destination: Set<string>,
  root: Document,
  selector: string,
  attrName: string,
  shouldInclude: (value: string) => boolean = () => true
) => {
  root.querySelectorAll(selector).forEach((element) => {
    const value = element.getAttribute(attrName)?.trim();
    if (!value || !shouldInclude(value)) return;
    destination.add(value);
  });
};

const addWheelLikeAttrValuesToSet = (
  destination: Set<string>,
  root: Document,
  selector: string,
  attrName: string
) => {
  addAttrValuesToSet(
    destination,
    root,
    selector,
    attrName,
    (value) => STUDIO_VENDOR_WHEEL_HINT_NAME_TOKEN_REGEX.test(value)
  );
};

const addAutoDriveHintAttrValuesToSet = (destination: Set<string>, root: Document) => {
  const autoSelector = `ros2_control[name="${STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME}"] joint[name]`;
  addAttrValuesToSet(destination, root, autoSelector, "name");
};

export const extractStudioDriveJointHintsFromUrdf = (urdfContent: string): Set<string> => {
  const hints = new Set<string>();
  if (!urdfContent.trim()) return hints;
  if (typeof DOMParser === "undefined") return hints;

  try {
    const xmlDoc = new DOMParser().parseFromString(urdfContent, "application/xml");
    if (xmlDoc.querySelector("parsererror")) {
      return hints;
    }

    // App-managed hints take priority so reloads honor exact wheel On/Off toggles.
    const autoHints = new Set<string>();
    addAutoDriveHintAttrValuesToSet(autoHints, xmlDoc);
    if (autoHints.size > 0) {
      return autoHints;
    }

    // Standard URDF transmission blocks.
    addWheelLikeAttrValuesToSet(hints, xmlDoc, "transmission > joint[name]", "name");
    addWheelLikeAttrValuesToSet(hints, xmlDoc, "transmission joint[name]", "name");

    // ROS2 control declarations.
    addWheelLikeAttrValuesToSet(hints, xmlDoc, "ros2_control > joint[name]", "name");
    addWheelLikeAttrValuesToSet(hints, xmlDoc, "ros2_control joint[name]", "name");
  } catch {
    return hints;
  }

  return hints;
};

type StudioDriveJointHintsPatchResult =
  | { success: true; applied: true; content: string; driveJointNames: string[] }
  | { success: true; applied: false; content: string; reason: "empty-joints" | "hints-present" }
  | { success: false; content: string; reason: "parse-error" | "missing-robot" };

type StudioDriveJointHintsPersistResult =
  | { success: true; content: string; driveJointNames: string[] }
  | { success: false; content: string; reason: "parse-error" | "missing-robot" };

type MutableStudioDriveHintsUrdf =
  | { success: true; xmlDoc: Document; robotElement: Element }
  | { success: false; reason: "parse-error" | "missing-robot" };

const readMutableStudioDriveHintsUrdf = (
  urdfContent: string
): MutableStudioDriveHintsUrdf => {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return { success: false, reason: "parse-error" };
  }

  const xmlDoc = new DOMParser().parseFromString(urdfContent, "application/xml");
  if (xmlDoc.querySelector("parsererror")) {
    return { success: false, reason: "parse-error" };
  }
  const robotElement = xmlDoc.querySelector("robot");
  if (!robotElement) {
    return { success: false, reason: "missing-robot" };
  }
  return { success: true, xmlDoc, robotElement };
};

const createStudioDriveHintsControlElement = (
  xmlDoc: Document,
  driveJointNames: readonly string[]
): Element => {
  const ros2ControlElement = xmlDoc.createElement("ros2_control");
  ros2ControlElement.setAttribute("name", STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME);
  ros2ControlElement.setAttribute("type", STUDIO_AUTO_DRIVE_HINT_CONTROL_TYPE);
  driveJointNames.forEach((jointName) => {
    const jointElement = xmlDoc.createElement("joint");
    jointElement.setAttribute("name", jointName);
    ros2ControlElement.appendChild(jointElement);
  });
  return ros2ControlElement;
};

const appendStudioDriveHintsControlElement = (
  xmlDoc: Document,
  robotElement: Element,
  driveJointNames: readonly string[]
) => {
  robotElement.appendChild(
    createStudioDriveHintsControlElement(xmlDoc, driveJointNames)
  );
};

const removeStudioDriveHintsControlElements = (xmlDoc: Document) => {
  xmlDoc
    .querySelectorAll(`ros2_control[name="${STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME}"]`)
    .forEach((element) => {
      element.parentNode?.removeChild(element);
    });
};

export const applyStudioDriveJointHintsToUrdf = (
  urdfContent: string,
  driveJointNames: string[]
): StudioDriveJointHintsPatchResult => {
  const normalizedDriveJointNames = toSortedUniqueJointNames(driveJointNames);
  if (normalizedDriveJointNames.length === 0) {
    return {
      success: true,
      applied: false,
      content: urdfContent,
      reason: "empty-joints",
    };
  }

  const existingHints = extractStudioDriveJointHintsFromUrdf(urdfContent);
  if (existingHints.size > 0) {
    return {
      success: true,
      applied: false,
      content: urdfContent,
      reason: "hints-present",
    };
  }

  try {
    const parsed = readMutableStudioDriveHintsUrdf(urdfContent);
    if (parsed.success === false) {
      return { success: false, content: urdfContent, reason: parsed.reason };
    }

    appendStudioDriveHintsControlElement(
      parsed.xmlDoc,
      parsed.robotElement,
      normalizedDriveJointNames
    );

    const serialized = new XMLSerializer().serializeToString(parsed.xmlDoc);
    return {
      success: true,
      applied: true,
      content: serialized,
      driveJointNames: normalizedDriveJointNames,
    };
  } catch {
    return { success: false, content: urdfContent, reason: "parse-error" };
  }
};

export const persistStudioDriveJointHintsToUrdf = (
  urdfContent: string,
  driveJointNames: string[]
): StudioDriveJointHintsPersistResult => {
  const normalizedDriveJointNames = toSortedUniqueJointNames(driveJointNames);

  try {
    const parsed = readMutableStudioDriveHintsUrdf(urdfContent);
    if (parsed.success === false) {
      return { success: false, content: urdfContent, reason: parsed.reason };
    }

    removeStudioDriveHintsControlElements(parsed.xmlDoc);

    if (normalizedDriveJointNames.length > 0) {
      appendStudioDriveHintsControlElement(
        parsed.xmlDoc,
        parsed.robotElement,
        normalizedDriveJointNames
      );
    }

    const serialized = new XMLSerializer().serializeToString(parsed.xmlDoc);
    return {
      success: true,
      content: serialized,
      driveJointNames: normalizedDriveJointNames,
    };
  } catch {
    return { success: false, content: urdfContent, reason: "parse-error" };
  }
};

export const resolveStudioActiveDriveJointNames = (
  allWheelJointNames: string[],
  defaultDriveJointNames: string[],
  overridesByJointName: Record<string, boolean>
): Set<string> => {
  const normalizedAll = toSortedUniqueJointNames(allWheelJointNames);
  const defaultDriveSet = new Set(toSortedUniqueJointNames(defaultDriveJointNames));
  const resolved = new Set<string>();
  let hasExplicitOverride = false;

  normalizedAll.forEach((jointName) => {
    const override = overridesByJointName[jointName];
    if (typeof override === "boolean") {
      hasExplicitOverride = true;
    }
    const isEnabled = typeof override === "boolean"
      ? override
      : defaultDriveSet.has(jointName);
    if (isEnabled) {
      resolved.add(jointName);
    }
  });

  if (resolved.size > 0) {
    return resolved;
  }
  if (hasExplicitOverride) {
    return resolved;
  }
  if (defaultDriveSet.size > 0) {
    return defaultDriveSet;
  }
  return new Set(normalizedAll);
};

export const toggleStudioWheelDriveJointOverride = ({
  jointName,
  wheels,
  previousOverrides,
}: {
  jointName: string;
  wheels: readonly { jointName: string; drivePreferred: boolean }[];
  previousOverrides: Record<string, boolean>;
}): Record<string, boolean> => {
  const allJointNames = wheels.map((wheel) => wheel.jointName);
  if (!allJointNames.includes(jointName)) return previousOverrides;

  const defaultDriveJointNames = wheels
    .filter((wheel) => wheel.drivePreferred)
    .map((wheel) => wheel.jointName);
  const defaultDriveJointNameSet = new Set(defaultDriveJointNames);
  const activeDriveJointNameSet = resolveStudioActiveDriveJointNames(
    allJointNames,
    defaultDriveJointNames,
    previousOverrides
  );
  const nextEnabled = !activeDriveJointNameSet.has(jointName);
  const defaultEnabled = defaultDriveJointNameSet.has(jointName);

  if (nextEnabled === defaultEnabled) {
    if (!Object.prototype.hasOwnProperty.call(previousOverrides, jointName)) {
      return previousOverrides;
    }
    const nextOverrides = { ...previousOverrides };
    delete nextOverrides[jointName];
    return nextOverrides;
  }

  if (previousOverrides[jointName] === nextEnabled) {
    return previousOverrides;
  }
  return {
    ...previousOverrides,
    [jointName]: nextEnabled,
  };
};

const STUDIO_WHEEL_NUMBER_START = 1;

export const toStudioWheelRoleDisplayEntries = <TEntry extends { jointName: string }>(
  roleEntries: readonly TEntry[],
  availableJointNames: ReadonlySet<string>
): Array<TEntry & { wheelNumber: number }> => {
  const displayEntries: Array<TEntry & { wheelNumber: number }> = [];
  roleEntries.forEach((entry) => {
    if (!availableJointNames.has(entry.jointName)) {
      return;
    }
    displayEntries.push({
      ...entry,
      wheelNumber: displayEntries.length + STUDIO_WHEEL_NUMBER_START,
    });
  });
  return displayEntries;
};

export type StudioWheelDriveAuthorityInput = {
  jointName: string;
  side: StudioWheelSide;
};

export type StudioWheelDriveAuthority = {
  linearScale: number;
  angularScale: number;
  activeDriveCount: number;
  totalWheelCount: number;
  hasLeftDrive: boolean;
  hasRightDrive: boolean;
};

export const computeStudioWheelDriveAuthority = (
  wheels: StudioWheelDriveAuthorityInput[],
  activeDriveJointNames: ReadonlySet<string>
): StudioWheelDriveAuthority => {
  const totalWheelCount = wheels.length;
  if (totalWheelCount === 0) {
    return {
      linearScale: 0,
      angularScale: 0,
      activeDriveCount: 0,
      totalWheelCount: 0,
      hasLeftDrive: false,
      hasRightDrive: false,
    };
  }

  let activeDriveCount = 0;
  let leftDriveCount = 0;
  let rightDriveCount = 0;
  wheels.forEach((wheel) => {
    if (!activeDriveJointNames.has(wheel.jointName)) {
      return;
    }
    activeDriveCount += 1;
    if (wheel.side === "left") {
      leftDriveCount += 1;
      return;
    }
    if (wheel.side === "right") {
      rightDriveCount += 1;
    }
  });

  if (activeDriveCount === 0) {
    return {
      linearScale: 0,
      angularScale: 0,
      activeDriveCount: 0,
      totalWheelCount,
      hasLeftDrive: false,
      hasRightDrive: false,
    };
  }

  const linearScale = activeDriveCount / totalWheelCount;
  const hasLeftDrive = leftDriveCount > 0;
  const hasRightDrive = rightDriveCount > 0;
  return {
    linearScale,
    angularScale: hasLeftDrive && hasRightDrive ? linearScale : 0,
    activeDriveCount,
    totalWheelCount,
    hasLeftDrive,
    hasRightDrive,
  };
};
