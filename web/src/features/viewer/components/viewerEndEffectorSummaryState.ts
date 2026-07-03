export type ViewerVector3 = readonly [number, number, number];

export type ViewerEndEffectorSummaryInput = {
  centerOfMassPosition: ViewerVector3 | null;
  endEffectorLinks: readonly string[];
  endEffectorPosition: ViewerVector3 | null;
  primaryEndEffectorLink: string | null | undefined;
  totalMassKg: number;
};

export type ViewerEndEffectorSummaryModel = {
  centerOfMassText: string;
  handleCount: number;
  handlesText: string;
  headerText: "EE" | "EEs";
  massText: string;
  primaryEndEffectorLinkText: string;
  primaryEndEffectorPositionText: string;
};

export const formatViewerVector3 = (vec: ViewerVector3, digits = 4) =>
  `${vec[0].toFixed(digits)}, ${vec[1].toFixed(digits)}, ${vec[2].toFixed(digits)}`;

export const buildViewerEndEffectorSummaryModel = ({
  centerOfMassPosition,
  endEffectorLinks,
  endEffectorPosition,
  primaryEndEffectorLink,
  totalMassKg,
}: ViewerEndEffectorSummaryInput): ViewerEndEffectorSummaryModel => ({
  centerOfMassText: centerOfMassPosition ? formatViewerVector3(centerOfMassPosition, 2) : "--",
  handleCount: endEffectorLinks.length,
  handlesText:
    endEffectorLinks.length > 0
      ? endEffectorLinks.map((linkName, index) => `${index + 1}:${linkName}`).join(" · ")
      : "None",
  headerText: endEffectorLinks.length === 1 ? "EE" : "EEs",
  massText: Number.isFinite(totalMassKg) && totalMassKg > 0
    ? `${totalMassKg.toFixed(2)} kg`
    : "--",
  primaryEndEffectorLinkText: primaryEndEffectorLink ?? "--",
  primaryEndEffectorPositionText: endEffectorPosition
    ? formatViewerVector3(endEffectorPosition, 2)
    : "--",
});
