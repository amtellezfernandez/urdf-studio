import { useEffect, useRef, useState } from "react";
import { escapeHtml } from "./urdfHighlight";
import { highlightUrdfAsync } from "./urdfProcessing";

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
export const URDFSyntaxHighlighter = ({ xml, className = "" }: URDFSyntaxHighlighterProps) => {
  const [highlightedHtml, setHighlightedHtml] = useState(() => escapeHtml(xml));
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setHighlightedHtml(escapeHtml(xml));
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      highlightUrdfAsync(xml, controller.signal).then((html) => {
        if (requestRef.current !== requestId) return;
        setHighlightedHtml(html);
      });
    }, 120);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [xml]);

  return (
    <pre
      className={`font-mono whitespace-pre-wrap break-words overflow-wrap-anywhere max-w-full ${className}`}
      style={{ wordBreak: "break-word", overflowWrap: "anywhere", lineHeight: "1.6" }}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
};
