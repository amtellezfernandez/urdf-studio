import { analyzeUrdf } from "@/shared/lib/urdfCore";

export const sanitizeFilename = (name: string) => {
  const cleaned = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    if (code < 32 || /[<>:"/\\|?*]/.test(char)) {
      return "_";
    }
    return char;
  }).join("");

  return (
    cleaned
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .trim()
      .replace(/^_+|_+$/g, "") || "robot"
  );
};

export const parseRobotName = (urdf: string) => {
  if (!urdf) return "robot";
  try {
    const analysis = analyzeUrdf(urdf);
    return analysis.robotName?.trim() || "robot";
  } catch {
    return "robot";
  }
};

export const sanitizeSpaceName = (value: string) => {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "urdfstudio-recordings"
  );
};
