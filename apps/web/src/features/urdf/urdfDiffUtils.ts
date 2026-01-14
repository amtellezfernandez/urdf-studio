import { canonicalOrderURDF } from "./canonicalOrdering";
import { prettyPrintURDF } from "./prettyPrintURDF";

interface UrdfComparisonResult {
  normalizedOriginal: string;
  normalizedModified: string;
  areEqual: boolean;
  differenceCount: number;
}

const normalizeUrdfForDiff = (content: string): string => {
  if (!content.trim()) return "";

  try {
    const canonical = canonicalOrderURDF(content);
    const pretty = prettyPrintURDF(canonical);
    return pretty.trim();
  } catch {
    return content.trim();
  }
};

export const compareUrdfs = (original: string, modified: string): UrdfComparisonResult => {
  const normalizedOriginal = normalizeUrdfForDiff(original);
  const normalizedModified = normalizeUrdfForDiff(modified);

  return {
    normalizedOriginal,
    normalizedModified,
    areEqual: normalizedOriginal === normalizedModified,
    differenceCount: countLineDifferences(normalizedOriginal, normalizedModified),
  };
};

const countLineDifferences = (a: string, b: string): number => {
  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);
  const maxLen = Math.max(aLines.length, bLines.length);

  let diffCount = 0;
  for (let i = 0; i < maxLen; i++) {
    const left = aLines[i]?.trim() ?? "";
    const right = bLines[i]?.trim() ?? "";
    if (left !== right) {
      diffCount++;
    }
  }

  return diffCount;
};
