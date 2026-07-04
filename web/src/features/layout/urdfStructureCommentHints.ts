export type StructureDirectiveTargetType = "joint" | "link";

export type StructureCommentHints = {
  jointLabelByName: Record<string, string>;
  linkLabelByName: Record<string, string>;
};

export type StructureCommentDirective = {
  label: string;
  targetType: StructureDirectiveTargetType | null;
  targetName: string | null;
};

const EMPTY_HINTS: StructureCommentHints = {
  jointLabelByName: {},
  linkLabelByName: {},
};

const TOKEN_PATTERN = /<!--([\s\S]*?)-->|<(joint|link)\b([^>]*)>/gi;
const NAME_ATTRIBUTE_PATTERN = /\bname\s*=\s*["']([^"']+)["']/i;
const DIRECTIVE_HEADER_PATTERN = /urdf-studio\s*:\s*(group|group-start)\b/i;
const LABEL_ATTRIBUTE_PATTERN = /\blabel\s*=\s*([^\s]+)/i;
const JOINT_ATTRIBUTE_PATTERN = /\bjoint\s*=\s*([^\s]+)/i;
const LINK_ATTRIBUTE_PATTERN = /\blink\s*=\s*([^\s]+)/i;
const LEADING_EQUALS_PATTERN = /^=\s*/;
const COMMENT_SEPARATOR_PATTERN = /\s+/g;

const normalizeLabel = (labelRaw: string): string => {
  return labelRaw.trim().toLowerCase().replace(COMMENT_SEPARATOR_PATTERN, "");
};

const normalizeTokenValue = (value: string): string => {
  return value
    .replace(LEADING_EQUALS_PATTERN, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
};

export const parseUrdfStructureDirectiveComment = (
  commentText: string
): StructureCommentDirective | null => {
  if (!DIRECTIVE_HEADER_PATTERN.test(commentText)) {
    return null;
  }

  const afterHeaderRaw = commentText
    .replace(DIRECTIVE_HEADER_PATTERN, "")
    .replace(LEADING_EQUALS_PATTERN, "")
    .trim();
  if (!afterHeaderRaw) {
    return null;
  }

  const labelMatch = afterHeaderRaw.match(LABEL_ATTRIBUTE_PATTERN);
  const jointMatch = afterHeaderRaw.match(JOINT_ATTRIBUTE_PATTERN);
  const linkMatch = afterHeaderRaw.match(LINK_ATTRIBUTE_PATTERN);

  let label = labelMatch ? normalizeTokenValue(labelMatch[1] ?? "") : "";
  if (!label) {
    const firstToken = afterHeaderRaw.split(COMMENT_SEPARATOR_PATTERN)[0] ?? "";
    label = normalizeTokenValue(firstToken);
  }
  const normalizedLabel = normalizeLabel(label);
  if (!normalizedLabel) return null;

  if (jointMatch) {
    const jointName = normalizeTokenValue(jointMatch[1] ?? "");
    if (!jointName) return null;
    return { label: normalizedLabel, targetType: "joint", targetName: jointName };
  }

  if (linkMatch) {
    const linkName = normalizeTokenValue(linkMatch[1] ?? "");
    if (!linkName) return null;
    return { label: normalizedLabel, targetType: "link", targetName: linkName };
  }

  return { label: normalizedLabel, targetType: null, targetName: null };
};

const parseNameAttribute = (tagAttributesRaw: string): string | null => {
  const nameMatch = tagAttributesRaw.match(NAME_ATTRIBUTE_PATTERN);
  if (!nameMatch || !nameMatch[1]) return null;
  const name = nameMatch[1].trim();
  return name.length > 0 ? name : null;
};

type StructureCommentHintAccumulator = {
  hints: StructureCommentHints;
  pendingLabel: string | null;
};

const createStructureCommentHintAccumulator = (): StructureCommentHintAccumulator => ({
  hints: {
    jointLabelByName: {},
    linkLabelByName: {},
  },
  pendingLabel: null,
});

const applyExplicitDirective = ({
  accumulator,
  directive,
}: {
  accumulator: StructureCommentHintAccumulator;
  directive: StructureCommentDirective;
}): void => {
  if (directive.targetType === "joint" && directive.targetName) {
    accumulator.hints.jointLabelByName[directive.targetName] = directive.label;
    accumulator.pendingLabel = null;
    return;
  }

  if (directive.targetType === "link" && directive.targetName) {
    accumulator.hints.linkLabelByName[directive.targetName] = directive.label;
    accumulator.pendingLabel = null;
    return;
  }

  accumulator.pendingLabel = directive.label;
};

const applyPendingDirectiveToTag = ({
  accumulator,
  tagAttributesRaw,
  tagTypeRaw,
}: {
  accumulator: StructureCommentHintAccumulator;
  tagAttributesRaw: string;
  tagTypeRaw: string;
}): void => {
  if (!accumulator.pendingLabel) {
    return;
  }

  const tagType = tagTypeRaw.toLowerCase();
  const tagName = parseNameAttribute(tagAttributesRaw);
  if (!tagName) {
    return;
  }

  if (tagType === "joint") {
    accumulator.hints.jointLabelByName[tagName] = accumulator.pendingLabel;
    accumulator.pendingLabel = null;
    return;
  }

  if (tagType === "link") {
    accumulator.hints.linkLabelByName[tagName] = accumulator.pendingLabel;
    accumulator.pendingLabel = null;
  }
};

const applyStructureCommentToken = ({
  accumulator,
  commentBody,
  tagAttributesRaw,
  tagTypeRaw,
}: {
  accumulator: StructureCommentHintAccumulator;
  commentBody?: string;
  tagAttributesRaw?: string;
  tagTypeRaw?: string;
}): void => {
  if (typeof commentBody === "string") {
    const directive = parseUrdfStructureDirectiveComment(commentBody);
    if (directive) {
      applyExplicitDirective({ accumulator, directive });
    }
    return;
  }

  if (tagTypeRaw && tagAttributesRaw) {
    applyPendingDirectiveToTag({
      accumulator,
      tagAttributesRaw,
      tagTypeRaw,
    });
  }
};

export const parseUrdfStructureCommentHints = (
  urdfContent: string | null | undefined
): StructureCommentHints => {
  if (!urdfContent) return EMPTY_HINTS;

  const accumulator = createStructureCommentHintAccumulator();

  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(urdfContent);
  while (match) {
    const commentBody = match[1];
    const tagTypeRaw = match[2];
    const tagAttributesRaw = match[3];

    applyStructureCommentToken({
      accumulator,
      commentBody,
      tagAttributesRaw,
      tagTypeRaw,
    });

    match = TOKEN_PATTERN.exec(urdfContent);
  }

  return accumulator.hints;
};

export const hasUrdfStructureCommentHints = (urdfContent: string | null | undefined): boolean => {
  const hints = parseUrdfStructureCommentHints(urdfContent);
  return (
    Object.keys(hints.jointLabelByName).length > 0 ||
    Object.keys(hints.linkLabelByName).length > 0
  );
};
