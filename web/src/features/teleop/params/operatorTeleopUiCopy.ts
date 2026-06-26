export const OPERATOR_TELEOP_PANEL_COPY = {
  camera: {
    panelTitle: "Cameras",
    panelSubtitle: "Live camera and point-cloud streams.",
  },
  studio: {
    navLabel: "Controller",
    navTitle: "Set up controller input",
    panelTitle: "Controller Input",
    panelSubtitle: "Use a leader arm, joystick, or browser controls.",
  },
  hardware: {
    navLabel: "Robot",
    navTitle: "Connect robot hardware",
    panelTitle: "Robot Hardware",
    panelSubtitle: "Follower motors, safety checks, and live cameras.",
  },
} as const;

export const OPERATOR_TELEOP_PANEL_FALLBACK_COPY = {
  panelTitle: "Teleop",
  panelSubtitle: "Watch robot motion or drive from this browser.",
} as const;
