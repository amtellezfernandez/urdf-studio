import type { EpisodeFrame } from "./episodeTypes";

export interface EpisodeCsvParseOptions {
  /**
   * Optional list or set of joint names that are allowed.
   * When provided, only values for these joints are kept.
   */
  allowedJoints?: Iterable<string>;
}

export interface EpisodeCsvParseResult {
  frames?: EpisodeFrame[];
  jointOrder?: string[];
  error?: string;
}

const TIMESTAMP_HEADER = "timestamp";

const normalizeHeader = (header: string) =>
  header.replace(".pos", "").trim();

const headerToJointName = (header: string) => {
  const cleaned = normalizeHeader(header);
  const match = cleaned.match(/^joint(.+)$/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return cleaned;
};

export const serializeEpisodeCsv = (
  frames: EpisodeFrame[],
  jointOrder: string[]
) => {
  const headers = [TIMESTAMP_HEADER, ...jointOrder.map((joint) => `joint${joint}`)];
  const rows = [headers.join(",")];

  for (const frame of frames) {
    const rowValues = [
      frame.timestamp,
      ...jointOrder.map((joint) => frame.joints[joint] ?? 0),
    ];
    rows.push(rowValues.join(","));
  }

  return rows.join("\n");
};

export const parseEpisodeCsv = (
  rawText: string,
  options: EpisodeCsvParseOptions = {}
): EpisodeCsvParseResult => {
  const text = rawText.trim();
  if (!text) {
    return { error: "Failed to read animation data file" };
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { error: "Data file is empty or invalid" };
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  const timestampIndex = headers.findIndex(
    (header) => header.toLowerCase() === TIMESTAMP_HEADER
  );

  if (timestampIndex === -1) {
    return { error: "Data file must have a 'timestamp' column" };
  }

  const allowedJointSet =
    options.allowedJoints !== undefined
      ? new Set(Array.from(options.allowedJoints))
      : null;

  const jointOrder: string[] = [];
  headers.forEach((header, index) => {
    if (index === timestampIndex) return;
    const jointName = headerToJointName(header);
    if (allowedJointSet && !allowedJointSet.has(jointName)) return;
    if (!jointOrder.includes(jointName)) {
      jointOrder.push(jointName);
    }
  });

  const frames: EpisodeFrame[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const rawValues = lines[lineIndex].split(",").map((value) => value.trim());
    if (rawValues.length !== headers.length) continue;

    const timestamp = parseFloat(rawValues[timestampIndex]);
    if (Number.isNaN(timestamp)) continue;

    const joints: Record<string, number> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      if (columnIndex === timestampIndex) continue;

      const jointName = headerToJointName(headers[columnIndex]);
      if (allowedJointSet && !allowedJointSet.has(jointName)) continue;

      const value = parseFloat(rawValues[columnIndex]);
      if (!Number.isNaN(value)) {
        joints[jointName] = value;
      }
    }

    frames.push({ timestamp, joints });
  }

  if (frames.length === 0) {
    return { error: "No valid frames found in the data file" };
  }

  return { frames, jointOrder };
};

