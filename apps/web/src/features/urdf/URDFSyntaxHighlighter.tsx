import React from "react";

interface URDFSyntaxHighlighterProps {
  xml: string;
  className?: string;
}

/**
 * Syntax highlighter for URDF XML - Blender/GitHub style
 * Highlights:
 * - XML tags in blue/cyan
 * - Attributes in yellow
 * - Numbers in green
 * - Strings/values in white/green
 * - Closing tags </ in dark grey
 * - Comments in grey
 */
export const URDFSyntaxHighlighter: React.FC<URDFSyntaxHighlighterProps> = ({ xml, className = "" }) => {
  const highlightXML = (text: string): React.ReactNode[] => {
    // Process line by line for better control
    const lines = text.split('\n');
    
    return lines.map((line, lineIndex) => {
      const lineParts: React.ReactNode[] = [];
      let currentIndex = 0;
      
      // Find comments first (highest priority)
      const commentRegex = /<!--[\s\S]*?-->/g;
      const commentMatch = commentRegex.exec(line);
      
      if (commentMatch) {
        // Text before comment
        if (commentMatch.index > currentIndex) {
          const before = line.substring(currentIndex, commentMatch.index);
          lineParts.push(...highlightLineContent(before, currentIndex));
        }
        // Comment
        lineParts.push(
          <span key={`comment-${lineIndex}`} className="text-muted-foreground/70 italic">
            {commentMatch[0]}
          </span>
        );
        currentIndex = commentMatch.index + commentMatch[0].length;
      }
      
      // Process remaining line
      if (currentIndex < line.length) {
        const remaining = line.substring(currentIndex);
        lineParts.push(...highlightLineContent(remaining, currentIndex));
      }
      
      return (
        <span key={`line-${lineIndex}`}>
          {lineParts}
          {lineIndex < lines.length - 1 && '\n'}
        </span>
      );
    });
  };
  
  const highlightLineContent = (text: string, offset: number): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    
    // Find all XML tags
    const tagRegex = /<\/?[\w:]+(?:\s+[^>]*)?\/?>/g;
    const matches: Array<{ start: number; end: number; content: string; isClosing: boolean }> = [];
    
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        isClosing: match[0].startsWith('</')
      });
    }
    
    // Process matches
    for (const tagMatch of matches) {
      // Text before tag
      if (tagMatch.start > currentIndex) {
        const before = text.substring(currentIndex, tagMatch.start);
        parts.push(...highlightTextContent(before, currentIndex + offset));
      }
      
      // Highlight tag
      if (tagMatch.isClosing) {
        // Closing tag: </ in dark grey, tag name in blue
        const closingPart = tagMatch.content.substring(0, 2);
        const rest = tagMatch.content.substring(2);
        parts.push(
          <span key={`tag-${tagMatch.start + offset}`}>
            <span className="text-muted-foreground/60">{closingPart}</span>
            <span className="text-blue-500 dark:text-blue-400">{rest}</span>
          </span>
        );
      } else if (tagMatch.content.startsWith('<?')) {
        // XML declaration
        parts.push(
          <span key={`tag-${tagMatch.start + offset}`} className="text-cyan-600 dark:text-cyan-400">
            {tagMatch.content}
          </span>
        );
      } else {
        // Opening tag - parse it
        const tagParts = parseTag(tagMatch.content, tagMatch.start + offset);
        parts.push(...tagParts);
      }
      
      currentIndex = tagMatch.end;
    }
    
    // Remaining text after last tag
    if (currentIndex < text.length) {
      const remaining = text.substring(currentIndex);
      parts.push(...highlightTextContent(remaining, currentIndex + offset));
    }
    
    return parts;
  };
  
  const parseTag = (tag: string, keyOffset: number): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    
    // Match: <tagname attributes>
    const tagMatch = tag.match(/^<([\w:]+)([^>]*)(\/?)>$/);
    if (!tagMatch) {
      return [<span key={`tag-${keyOffset}`} className="text-blue-500 dark:text-blue-400">{tag}</span>];
    }

    const tagName = tagMatch[1];
    const attributes = tagMatch[2];
    const selfClosing = tagMatch[3];

    // Opening bracket and tag name
    parts.push(
      <span key={`tag-open-${keyOffset}`} className="text-blue-500 dark:text-blue-400">{`<${tagName}`}</span>
    );
    
    // Attributes
    if (attributes.trim()) {
      const attrParts = parseAttributes(attributes, keyOffset);
      parts.push(...attrParts);
    }
    
    // Self-closing or closing bracket
    if (selfClosing) {
      parts.push(
        <span key={`tag-close-${keyOffset}`} className="text-blue-500 dark:text-blue-400">{`${selfClosing}>`}</span>
      );
    } else {
      parts.push(
        <span key={`tag-close-${keyOffset}`} className="text-blue-500 dark:text-blue-400">{`>`}</span>
      );
    }
    
    return parts;
  };
  
  const parseAttributes = (attrString: string, keyOffset: number): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    
    // Match attribute name="value"
    const attrRegex = /(\w+)\s*=\s*("[^"]*")/g;
    let match;
    
    while ((match = attrRegex.exec(attrString)) !== null) {
      // Whitespace before attribute
      if (match.index > currentIndex) {
        const before = attrString.substring(currentIndex, match.index);
        parts.push(
          <span key={`attr-space-${keyOffset + currentIndex}`} className="text-foreground">
            {before}
          </span>
        );
      }
      
      // Attribute name and value
      parts.push(
        <span key={`attr-${keyOffset + match.index}`}>
          <span className="text-yellow-600 dark:text-yellow-400">{match[1]}</span>
          <span className="text-foreground">=</span>
          <span className="text-green-600 dark:text-green-400">{match[2]}</span>
        </span>
      );
      
      currentIndex = match.index + match[0].length;
    }
    
    // Remaining whitespace
    if (currentIndex < attrString.length) {
      const remaining = attrString.substring(currentIndex);
      parts.push(
        <span key={`attr-end-${keyOffset + currentIndex}`} className="text-foreground">
          {remaining}
        </span>
      );
    }
    
    return parts;
  };
  
  const highlightTextContent = (text: string, keyOffset: number): React.ReactNode[] => {
    if (!text.trim()) {
      return [<span key={`text-${keyOffset}`} className="text-foreground">{text}</span>];
    }
    
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    
    // Find numbers
    const numberRegex = /-?\d+\.?\d*/g;
    let match;
    
    while ((match = numberRegex.exec(text)) !== null) {
      // Text before number
      if (match.index > currentIndex) {
        const before = text.substring(currentIndex, match.index);
        parts.push(
          <span key={`text-${keyOffset + currentIndex}`} className="text-foreground">
            {before}
          </span>
        );
      }
      
      // Number in green
      parts.push(
        <span key={`num-${keyOffset + match.index}`} className="text-green-600 dark:text-green-400">
          {match[0]}
        </span>
      );
      
      currentIndex = match.index + match[0].length;
    }
    
    // Remaining text (white)
    if (currentIndex < text.length) {
      const remaining = text.substring(currentIndex);
      parts.push(
        <span key={`text-${keyOffset + currentIndex}`} className="text-foreground">
          {remaining}
        </span>
      );
    }
    
    return parts.length > 0 ? parts : [<span key={`text-${keyOffset}`} className="text-foreground">{text}</span>];
  };
  
  return (
    <pre className={`font-mono whitespace-pre-wrap break-words overflow-wrap-anywhere max-w-full ${className}`} style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', lineHeight: '1.6' }}>
      {highlightXML(xml)}
    </pre>
  );
};
