import { ArrowRight, ArrowUp, ArrowDown, ArrowLeft } from "lucide-react";
import type React from "react";

export const JOINT_TYPES = [
  "continuous",
  "revolute",
  "prismatic",
  "fixed",
  "planar",
  "floating",
] as const;

export const AXIS_PRESETS: Record<string, { axis: [number, number, number]; label: string; icon: React.ReactNode }> = {
  "X (1 0 0)": {
    axis: [1, 0, 0],
    label: "X-axis",
    icon: <ArrowRight className="w-3 h-3 text-red-500" />
  },
  "Y (0 1 0)": {
    axis: [0, 1, 0],
    label: "Y-axis",
    icon: <ArrowUp className="w-3 h-3 text-green-500" />
  },
  "Z (0 0 1)": {
    axis: [0, 0, 1],
    label: "Z-axis",
    icon: <ArrowUp className="w-3 h-3 text-blue-500 rotate-[135deg]" />
  },
  "-X (-1 0 0)": {
    axis: [-1, 0, 0],
    label: "-X-axis",
    icon: <ArrowLeft className="w-3 h-3 text-red-500" />
  },
  "-Y (0 -1 0)": {
    axis: [0, -1, 0],
    label: "-Y-axis",
    icon: <ArrowDown className="w-3 h-3 text-green-500" />
  },
  "-Z (0 0 -1)": {
    axis: [0, 0, -1],
    label: "-Z-axis",
    icon: <ArrowDown className="w-3 h-3 text-blue-500 rotate-[135deg]" />
  },
};

