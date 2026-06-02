export const DATASET_SIGNAL_PROFILE_PARAMS = {
  version: "1.0.0",
  positionSuffixes: [".pos", ".position"] as const,
  velocitySuffixes: [".vel", ".velocity"] as const,
  effortSuffixes: [".effort", ".torque"] as const,
  planarTwistAliases: {
    x: ["x.vel", "x.velocity", "vx", "linear.x", "linear_x"],
    y: ["y.vel", "y.velocity", "vy", "linear.y", "linear_y"],
    theta: [
      "theta.vel",
      "theta.velocity",
      "yaw.vel",
      "yaw.velocity",
      "wz",
      "omega.z",
      "angular.z",
      "angular_z",
    ],
  } as const,
  planarBasePoseAliases: {
    xMm: ["x_mm", "x.mm", "base_x_mm", "base.x_mm"],
    yMm: ["y_mm", "y.mm", "base_y_mm", "base.y_mm"],
    thetaDeg: ["theta", "theta_deg", "theta.deg", "yaw_deg", "base_theta"],
  } as const,
  degToRad: Math.PI / 180,
  mmToMeters: 0.001,
  angularUnitDetection: {
    degreeNameTokens: ["deg", "degree"] as const,
    radianNameTokens: ["rad", "radian"] as const,
    // Values above this are unlikely to be radians for planar heading/heading rate.
    radiansLikelyAbsMax: Math.PI * 2,
    defaultBasePoseThetaUnit: "rad" as const,
    defaultPlanarTwistThetaUnit: "rad" as const,
  },
  genericPlanarBaseChannels: {
    xMm: ["x mm"] as const,
    yMm: ["y mm"] as const,
    theta: ["theta"] as const,
  },
  maxTwistIntegrationDtSec: 0.5,
} as const;

export const DATASET_SIGNAL_PROFILE_IDS = {
  urdfNative: "urdf_native",
  lekiwiClient: "lekiwi_client",
  mixed: "mixed",
} as const;
