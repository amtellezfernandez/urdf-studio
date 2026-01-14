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
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdf, "text/xml");
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      return "robot";
    }

    const robotName = xmlDoc.querySelector("robot")?.getAttribute("name");
    return robotName?.trim() || "robot";
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

const normalizeSpaceInput = (input: string) => {
  return input
    .trim()
    .replace(/^https?:\/\/huggingface\.co\/spaces\//i, "")
    .replace(/^spaces\//i, "");
};

export const parseSpaceInput = (input: string, defaultOwner?: string) => {
  const normalized = normalizeSpaceInput(input);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], name: parts[1] };
  }
  if (parts.length === 1 && defaultOwner) {
    return { owner: defaultOwner, name: parts[0] };
  }
  return null;
};
