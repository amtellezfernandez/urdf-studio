const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const wrap = (className: string, text: string) =>
  `<span class="${className}">${escapeHtml(text)}</span>`;

const highlightTextContent = (text: string) => {
  if (!text.trim()) {
    return escapeHtml(text);
  }

  const parts: string[] = [];
  let currentIndex = 0;
  const numberRegex = /-?\d+\.?\d*/g;
  let match: RegExpExecArray | null;

  while ((match = numberRegex.exec(text)) !== null) {
    if (match.index > currentIndex) {
      const before = text.substring(currentIndex, match.index);
      parts.push(wrap("text-foreground", before));
    }
    parts.push(wrap("text-green-600 dark:text-green-400", match[0]));
    currentIndex = match.index + match[0].length;
  }

  if (currentIndex < text.length) {
    parts.push(wrap("text-foreground", text.substring(currentIndex)));
  }

  return parts.join("");
};

const parseAttributes = (attrString: string) => {
  const parts: string[] = [];
  let currentIndex = 0;
  const attrRegex = /(\w+)\s*=\s*("[^"]*")/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    if (match.index > currentIndex) {
      parts.push(wrap("text-foreground", attrString.substring(currentIndex, match.index)));
    }
    parts.push(
      `<span class="text-yellow-600 dark:text-yellow-400">${escapeHtml(match[1])}</span>` +
        `<span class="text-foreground">=</span>` +
        `<span class="text-green-600 dark:text-green-400">${escapeHtml(match[2])}</span>`
    );
    currentIndex = match.index + match[0].length;
  }

  if (currentIndex < attrString.length) {
    parts.push(wrap("text-foreground", attrString.substring(currentIndex)));
  }

  return parts.join("");
};

const parseTag = (tag: string) => {
  const tagMatch = tag.match(/^<([\w:]+)([^>]*)(\/?)>$/);
  if (!tagMatch) {
    return wrap("text-blue-500 dark:text-blue-400", tag);
  }

  const tagName = tagMatch[1];
  const attributes = tagMatch[2];
  const selfClosing = tagMatch[3];
  const parts: string[] = [];

  parts.push(wrap("text-blue-500 dark:text-blue-400", `<${tagName}`));
  if (attributes.trim()) {
    parts.push(parseAttributes(attributes));
  }
  parts.push(
    wrap("text-blue-500 dark:text-blue-400", selfClosing ? `${selfClosing}>` : ">")
  );

  return parts.join("");
};

const highlightLineContent = (text: string) => {
  const tagRegex = /<\/?[\w:]+(?:\s+[^>]*)?\/?>/g;
  const matches: Array<{ start: number; end: number; content: string; isClosing: boolean }> = [];

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[0],
      isClosing: match[0].startsWith("</"),
    });
  }

  const parts: string[] = [];
  let currentIndex = 0;

  for (const tagMatch of matches) {
    if (tagMatch.start > currentIndex) {
      parts.push(highlightTextContent(text.substring(currentIndex, tagMatch.start)));
    }

    if (tagMatch.isClosing) {
      const closingPart = tagMatch.content.substring(0, 2);
      const rest = tagMatch.content.substring(2);
      parts.push(
        `<span class="text-muted-foreground/60">${escapeHtml(closingPart)}</span>` +
          `<span class="text-blue-500 dark:text-blue-400">${escapeHtml(rest)}</span>`
      );
    } else if (tagMatch.content.startsWith("<?")) {
      parts.push(wrap("text-cyan-600 dark:text-cyan-400", tagMatch.content));
    } else {
      parts.push(parseTag(tagMatch.content));
    }

    currentIndex = tagMatch.end;
  }

  if (currentIndex < text.length) {
    parts.push(highlightTextContent(text.substring(currentIndex)));
  }

  return parts.join("");
};

export const highlightUrdfToHtml = (xml: string) => {
  const lines = xml.split("\n");

  return lines
    .map((line) => {
      const commentRegex = /<!--[\s\S]*?-->/g;
      const commentMatch = commentRegex.exec(line);
      let currentIndex = 0;
      const parts: string[] = [];

      if (commentMatch) {
        if (commentMatch.index > currentIndex) {
          const before = line.substring(currentIndex, commentMatch.index);
          parts.push(highlightLineContent(before));
        }
        parts.push(
          wrap("text-muted-foreground/70 italic", commentMatch[0])
        );
        currentIndex = commentMatch.index + commentMatch[0].length;
      }

      if (currentIndex < line.length) {
        parts.push(highlightLineContent(line.substring(currentIndex)));
      }

      return parts.join("");
    })
    .join("\n");
};

export { escapeHtml };
