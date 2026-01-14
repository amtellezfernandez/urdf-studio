import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Textarea } from "@/shared/ui/textarea";
import { X, ChevronDown, Info, Copy, Edit, GitCompare } from "lucide-react";
import { toast } from "sonner";
import { URDFSyntaxHighlighter } from "./URDFSyntaxHighlighter";
import { cn } from "@/shared/lib/utils";
import { SaveToGitHubDialog } from "@/features/dataset/SaveToGitHubDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import {
  canonicalizeUrdf,
  compareUrdfs,
  fixMeshPaths,
  normalizeAxes,
  prettifyUrdf,
} from "@/features/urdf";
import {
  convertUrdfToMjcfCached,
  convertUrdfToXacroCached,
  getUrdfStats,
  getUrdfStatsAsync,
} from "@/features/urdf/urdfProcessing";

interface URDFComparisonProps {
  originalUrdf: string;
  vizUrdf: string;
  isOpen: boolean;
  onClose: () => void;
  onVizUrdfChange?: (newContent: string) => void;
  getExportUrdf?: () => string;
  meshFiles?: Record<string, Blob>;
  githubToken?: string | null;
  inline?: boolean; // If true, render inline instead of as Dialog
  splitView?: boolean; // If true, render in split view (simulation top, editor bottom)
  onSplitViewToggle?: (split: boolean) => void;
  selectedView?: "original" | "modified" | "split";
  onSelectedViewChange?: (view: "original" | "modified" | "split") => void;
}

export const URDFComparison = ({
  originalUrdf,
  vizUrdf,
  isOpen,
  onClose,
  onVizUrdfChange,
  getExportUrdf,
  meshFiles = {},
  githubToken,
  inline = false,
  splitView = false,
  onSplitViewToggle,
  selectedView: selectedViewProp,
  onSelectedViewChange,
}: URDFComparisonProps) => {
  const [internalSelectedView, setInternalSelectedView] = useState<"original" | "modified" | "split">("split");
  const selectedView = selectedViewProp ?? internalSelectedView;
  const setSelectedView = onSelectedViewChange ?? setInternalSelectedView;
  const [isEditing, setIsEditing] = useState(false);
  const [editedVizUrdf, setEditedVizUrdf] = useState(vizUrdf);
  const [showSaveToGitHub, setShowSaveToGitHub] = useState(false);
  const [originalFormat, setOriginalFormat] = useState<"urdf" | "xacro" | "mjcf">("urdf");
  const [modifiedFormat, setModifiedFormat] = useState<"urdf" | "xacro" | "mjcf">("urdf");

  // Parse URDF content in real-time
  const activeUrdf = isEditing ? editedVizUrdf : vizUrdf;

  const [parseInfo, setParseInfo] = useState(() => getUrdfStats(activeUrdf));
  const [originalParseInfo, setOriginalParseInfo] = useState(() =>
    getUrdfStats(originalUrdf)
  );
  const parseRequestRef = useRef(0);
  const originalParseRequestRef = useRef(0);

  useEffect(() => {
    const requestId = parseRequestRef.current + 1;
    parseRequestRef.current = requestId;
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      getUrdfStatsAsync(activeUrdf, controller.signal).then((stats) => {
        if (parseRequestRef.current !== requestId) return;
        setParseInfo(stats);
      });
    }, 120);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [activeUrdf]);

  useEffect(() => {
    const requestId = originalParseRequestRef.current + 1;
    originalParseRequestRef.current = requestId;
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      getUrdfStatsAsync(originalUrdf, controller.signal).then((stats) => {
        if (originalParseRequestRef.current !== requestId) return;
        setOriginalParseInfo(stats);
      });
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [originalUrdf]);

  const formatXML = (xml: string): string => {
    try {
      // Simple XML formatting with indentation
      let formatted = "";
      let indent = 0;
      const indentSize = 2;
      
      // Split by tags and process
      const regex = /(<\?xml[^>]*\?>)|(<[^>]+>)|([^<]+)/g;
      let match;
      
      while ((match = regex.exec(xml)) !== null) {
        const tag = match[0];
        
        // Closing tag
        if (tag.startsWith("</")) {
          indent--;
          formatted += " ".repeat(indent * indentSize) + tag + "\n";
        }
        // XML declaration or self-closing tag
        else if (tag.startsWith("<?") || tag.endsWith("/>")) {
          formatted += " ".repeat(indent * indentSize) + tag + "\n";
        }
        // Opening tag
        else if (tag.startsWith("<")) {
          formatted += " ".repeat(indent * indentSize) + tag + "\n";
          if (!tag.endsWith("/>")) {
            indent++;
          }
        }
        // Text content
        else if (tag.trim()) {
          formatted += " ".repeat(indent * indentSize) + tag.trim() + "\n";
        }
      }
      
      return formatted || xml;
    } catch (e) {
      return xml;
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard`);
  };

  const downloadURDF = (content: string, filename: string, useExportVersion = false) => {
    // If downloading viz URDF and export version is available, use it
    const finalContent = (useExportVersion && getExportUrdf && filename.includes("viz")) 
      ? getExportUrdf() 
      : content;
    const blob = new Blob([finalContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  // Update edited content when vizUrdf changes externally (but not when editing)
  useEffect(() => {
    if (!isEditing) {
      setEditedVizUrdf(vizUrdf);
    }
  }, [vizUrdf, isEditing]);

  const handleSave = () => {
    try {
      // Validate XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(editedVizUrdf, "text/xml");
      const parserError = xmlDoc.querySelector("parsererror");
      
      if (parserError) {
        toast.error("Invalid XML. Please check your edits.");
        return;
      }
      
      onVizUrdfChange?.(editedVizUrdf);
      setIsEditing(false);
      toast.success("Viz URDF updated successfully");
    } catch (error) {
      toast.error("Failed to parse XML. Please check your edits.");
    }
  };

  const handleCancel = () => {
    setEditedVizUrdf(vizUrdf);
    setIsEditing(false);
  };

  // URDF Utility Handlers
  const handleCanonicalOrder = () => {
    const currentContent = isEditing ? editedVizUrdf : vizUrdf;
    const result = canonicalizeUrdf(currentContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to reorder URDF");
      return;
    }
    if (isEditing) {
      setEditedVizUrdf(result.content);
    } else {
      onVizUrdfChange?.(result.content);
    }
    toast.success(result.message ?? "URDF elements reordered to canonical format");
  };

  const handlePrettyPrint = () => {
    const currentContent = isEditing ? editedVizUrdf : vizUrdf;
    const result = prettifyUrdf(currentContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to format URDF");
      return;
    }
    if (isEditing) {
      setEditedVizUrdf(result.content);
    } else {
      onVizUrdfChange?.(result.content);
    }
    toast.success(result.message ?? "URDF formatted with consistent indentation");
  };

  const handleNormalizeAxes = () => {
    const currentContent = isEditing ? editedVizUrdf : vizUrdf;
    const result = normalizeAxes(currentContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to normalize joint axes");
      return;
    }
    if (isEditing) {
      setEditedVizUrdf(result.content);
    } else {
      onVizUrdfChange?.(result.content);
    }

    if (result.issues.length > 0) {
      toast.warning(`Normalized axes with ${result.issues.length} error(s) fixed`);
      result.issues.forEach(err => {
        console.warn(`Joint "${err.jointName}" (${err.jointType}): ${err.issue}`);
      });
    } else if (result.corrections.length > 0) {
      toast.success(result.message ?? `Normalized ${result.corrections.length} joint axis(es)`);
      result.corrections.forEach(correction => {
        console.info(`Joint "${correction.jointName}": ${correction.reason}`);
      });
    } else {
      toast.info("All joint axes are already normalized");
    }
  };

  const handleFixMeshPaths = () => {
    const currentContent = isEditing ? editedVizUrdf : vizUrdf;
    const result = fixMeshPaths(currentContent);
    if (isEditing) {
      setEditedVizUrdf(result.urdfContent);
    } else {
      onVizUrdfChange?.(result.urdfContent);
    }

    if (result.corrections.length > 0) {
      toast.success(`Fixed ${result.corrections.length} mesh path(s) using package "${result.packageName}"`);
      result.corrections.forEach(correction => {
        console.info(`${correction.linkName} (${correction.element}): ${correction.reason}`);
        console.info(`  ${correction.original} → ${correction.corrected}`);
      });
    } else {
      toast.info("All mesh paths are already correct");
    }
  };

  // Extract robot name from URDF for export
  const robotName = useMemo(() => {
    const stats = getUrdfStats(vizUrdf);
    return stats.robotName || "robot";
  }, [vizUrdf]);

  const formattedOriginal = formatXML(originalUrdf);
  const formattedViz = formatXML(isEditing ? editedVizUrdf : vizUrdf);

  // Convert to different formats for display
  const originalXacro = useMemo(() => {
    try {
      const result = convertUrdfToXacroCached(originalUrdf);
      return formatXML(result.xacroContent);
    } catch {
      return formattedOriginal;
    }
  }, [originalUrdf, formattedOriginal]);

  const originalMJCF = useMemo(() => {
    try {
      const result = convertUrdfToMjcfCached(originalUrdf);
      return formatXML(result.mjcfContent);
    } catch {
      return formattedOriginal;
    }
  }, [originalUrdf, formattedOriginal]);

  const modifiedXacro = useMemo(() => {
    try {
      const urdfContent = isEditing ? editedVizUrdf : (getExportUrdf ? getExportUrdf() : vizUrdf);
      const result = convertUrdfToXacroCached(urdfContent);
      return formatXML(result.xacroContent);
    } catch {
      return formattedViz;
    }
  }, [isEditing, editedVizUrdf, getExportUrdf, vizUrdf, formattedViz]);

  const modifiedMJCF = useMemo(() => {
    try {
      const urdfContent = isEditing ? editedVizUrdf : (getExportUrdf ? getExportUrdf() : vizUrdf);
      const result = convertUrdfToMjcfCached(urdfContent);
      return formatXML(result.mjcfContent);
    } catch {
      return formattedViz;
    }
  }, [isEditing, editedVizUrdf, getExportUrdf, vizUrdf, formattedViz]);

  const comparisonTarget = useMemo(
    () => (isEditing ? editedVizUrdf : (getExportUrdf ? getExportUrdf() : vizUrdf)),
    [editedVizUrdf, getExportUrdf, isEditing, vizUrdf]
  );

  const comparison = useMemo(
    () => compareUrdfs(originalUrdf, comparisonTarget),
    [originalUrdf, comparisonTarget]
  );

  // Get displayed content based on format
  const getOriginalContent = () => {
    switch (originalFormat) {
      case "xacro":
        return originalXacro;
      case "mjcf":
        return originalMJCF;
      default:
        return formattedOriginal;
    }
  };

  const getModifiedContent = () => {
    switch (modifiedFormat) {
      case "xacro":
        return modifiedXacro;
      case "mjcf":
        return modifiedMJCF;
      default:
        return formattedViz;
    }
  };

  // Reset format to URDF when editing starts
  useEffect(() => {
    if (isEditing && modifiedFormat !== "urdf") {
      setModifiedFormat("urdf");
    }
  }, [isEditing, modifiedFormat]);

  const content = (
    <div className={cn(
      "flex flex-col",
      inline ? "w-full h-full absolute inset-0 bg-background z-50" : "h-full"
    )}>
      {!inline && (
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="w-5 h-5" />
            URDF Editor
          </DialogTitle>
          <DialogDescription>
            View and edit the URDF files. Compare original with modified visualization URDF.
          </DialogDescription>
        </DialogHeader>
      )}

      {inline && (
        <div className="flex items-center justify-end px-1.5 py-0.5 border-b border-border/20 bg-muted/5 flex-shrink-0">
          <button
            className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 rounded-sm transition-colors"
            onClick={onClose}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      )}

      <div className={cn(
        "flex-1 min-h-0 overflow-y-auto",
        inline && "p-2"
      )}>


        <div className={cn(
          "flex flex-col gap-2 flex-1 min-h-0",
          inline && "overflow-hidden"
        )}>

          <div className="flex items-center gap-2 px-1 mt-1">
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-sm border",
                comparison.areEqual
                  ? "text-green-500 border-green-500/40 bg-green-500/5"
                  : "text-amber-500 border-amber-500/40 bg-amber-500/5"
              )}
            >
              {comparison.areEqual ? "In Sync" : "Differences"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {comparison.areEqual
                ? "Normalized contents match"
                : `${comparison.differenceCount} differing line(s) after canonical formatting`}
            </span>
          </div>

          {/* Content Area */}
          <div className="flex-1 grid gap-2 min-h-0 mt-2" style={{
            gridTemplateColumns: selectedView === "split" ? "1fr 1fr" : "1fr"
          }}>
            {/* Original URDF */}
            {(selectedView === "original" || selectedView === "split") && (
              <div className="flex flex-col gap-1 min-h-0 min-w-0">
                <div className="flex items-center justify-between px-1 mb-0.5">
                  <div className="flex items-center gap-1">
                    <h3 className="text-xs font-medium">Original</h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 rounded-sm transition-colors">
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-32">
                        <DropdownMenuItem
                          onClick={() => setOriginalFormat("urdf")}
                          className={cn(
                            "text-xs cursor-pointer",
                            originalFormat === "urdf" && "bg-primary/20 text-primary"
                          )}
                        >
                          URDF
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setOriginalFormat("xacro")}
                          className={cn(
                            "text-xs cursor-pointer",
                            originalFormat === "xacro" && "bg-primary/20 text-primary"
                          )}
                        >
                          Xacro
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setOriginalFormat("mjcf")}
                          className={cn(
                            "text-xs cursor-pointer",
                            originalFormat === "mjcf" && "bg-primary/20 text-primary"
                          )}
                        >
                          MJCF
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <span className="text-[9px] text-muted-foreground ml-1">
                      ({originalFormat.toUpperCase()})
                    </span>
                  </div>
                  {originalParseInfo.isValid ? (
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <button className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 rounded-sm transition-colors">
                          <Info className="w-3 h-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        <p className="font-medium">{originalParseInfo.robotName}</p>
                        <p className="text-muted-foreground">
                          {originalParseInfo.links} links • {originalParseInfo.joints} joints • {originalParseInfo.materials} materials
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <button className="h-4 w-4 flex items-center justify-center text-red-500 hover:bg-red-500/20 rounded-sm transition-colors">
                          <Info className="w-3 h-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        <p className="text-red-500">Invalid: {originalParseInfo.error}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="flex items-center gap-1 px-1 mb-1 flex-wrap">
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 rounded-sm transition-colors"
                        onClick={() => copyToClipboard(getOriginalContent(), `Original ${originalFormat.toUpperCase()}`)}
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Copy {originalFormat.toUpperCase()}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <ScrollArea className="flex-1 border border-border/20 rounded-sm overflow-hidden [&>[data-radix-scroll-area-scrollbar]]:w-[2px] [&>[data-radix-scroll-area-scrollbar]]:bg-transparent [&>[data-radix-scroll-area-scrollbar]]:p-0 [&>[data-radix-scroll-area-thumb]]:bg-[hsl(0,0%,30%)] [&>[data-radix-scroll-area-thumb]]:rounded-full [&>[data-radix-scroll-area-thumb]]:hover:bg-[hsl(0,0%,40%)]">
                  <div className="min-w-0 p-3 bg-muted/20">
                    <URDFSyntaxHighlighter xml={getOriginalContent()} className="text-xs leading-relaxed" />
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Modified URDF */}
            {(selectedView === "modified" || selectedView === "split") && (
              <div className="flex flex-col gap-1 min-h-0 min-w-0">
                <div className="flex items-center justify-between px-1 mb-0.5">
                  <div className="flex items-center gap-1">
                    <h3 className="text-xs font-medium">Modified</h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button 
                          className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 rounded-sm transition-colors"
                          disabled={isEditing}
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-32">
                        <DropdownMenuItem
                          onClick={() => {
                            setModifiedFormat("urdf");
                            if (isEditing) setIsEditing(false);
                          }}
                          className={cn(
                            "text-xs cursor-pointer",
                            modifiedFormat === "urdf" && "bg-primary/20 text-primary"
                          )}
                        >
                          URDF
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setModifiedFormat("xacro");
                            if (isEditing) setIsEditing(false);
                          }}
                          className={cn(
                            "text-xs cursor-pointer",
                            modifiedFormat === "xacro" && "bg-primary/20 text-primary"
                          )}
                        >
                          Xacro
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setModifiedFormat("mjcf");
                            if (isEditing) setIsEditing(false);
                          }}
                          className={cn(
                            "text-xs cursor-pointer",
                            modifiedFormat === "mjcf" && "bg-primary/20 text-primary"
                          )}
                        >
                          MJCF
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <span className="text-[9px] text-muted-foreground ml-1">
                      ({modifiedFormat.toUpperCase()})
                    </span>
                  </div>
                  {parseInfo.isValid ? (
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <button className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 rounded-sm transition-colors">
                          <Info className="w-3 h-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        <p className="font-medium">{parseInfo.robotName}</p>
                        <p className="text-muted-foreground">
                          {parseInfo.links} links • {parseInfo.joints} joints • {parseInfo.materials} materials
                          {isEditing && <span className="ml-1 text-orange-500">(editing)</span>}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <button className="h-4 w-4 flex items-center justify-center text-red-500 hover:bg-red-500/20 rounded-sm transition-colors">
                          <Info className="w-3 h-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        <p className="text-red-500">Invalid: {parseInfo.error}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="flex items-center gap-1 px-1 mb-1 flex-wrap">
                  {!isEditing && modifiedFormat === "urdf" ? (
                    <>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <button
                            className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 rounded-sm transition-colors"
                            onClick={() => setIsEditing(true)}
                          >
                            <Edit className="w-3 h-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Edit
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <button
                            className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 rounded-sm transition-colors"
                            onClick={() => copyToClipboard(getModifiedContent(), `Modified ${modifiedFormat.toUpperCase()}`)}
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Copy {modifiedFormat.toUpperCase()}
                        </TooltipContent>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      <button
                        className="text-[10px] bg-primary/20 text-primary px-1 py-0.5 rounded-sm transition-colors hover:bg-primary/30"
                        onClick={handleSave}
                      >
                        Save
                      </button>
                      <button
                        className="text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 px-1 py-0.5 rounded-sm transition-colors"
                        onClick={handleCancel}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
                {isEditing ? (
                  <div className="flex flex-col gap-2 flex-1">
                    {/* Real-time parse status while editing */}
                    {!parseInfo.isValid && (
                      <div className="px-2 py-1 bg-red-500/10 border border-red-500/30 rounded-sm mb-1">
                        <div className="text-[10px] text-red-500">
                          Invalid XML: {parseInfo.error}
                        </div>
                      </div>
                    )}
                    {parseInfo.isValid && (
                      <div className="px-2 py-1 bg-green-500/10 border border-green-500/30 rounded-sm mb-1">
                        <div className="text-[10px] text-green-700 dark:text-green-400">
                          Valid URDF: {parseInfo.robotName} • {parseInfo.links} links, {parseInfo.joints} joints, {parseInfo.materials} materials
                        </div>
                      </div>
                    )}
                    <Textarea
                      value={editedVizUrdf}
                      onChange={(e) => setEditedVizUrdf(e.target.value)}
                      className={cn(
                        "flex-1 font-mono text-[10px] min-h-[400px] border-border/20",
                        !parseInfo.isValid && "border-red-500/50 focus-visible:ring-red-500/50"
                      )}
                      placeholder="Edit URDF content..."
                    />
                  </div>
                ) : (
                  <ScrollArea className="flex-1 border border-border/20 rounded-sm overflow-hidden [&>[data-radix-scroll-area-scrollbar]]:w-[2px] [&>[data-radix-scroll-area-scrollbar]]:bg-transparent [&>[data-radix-scroll-area-scrollbar]]:p-0 [&>[data-radix-scroll-area-thumb]]:bg-[hsl(0,0%,30%)] [&>[data-radix-scroll-area-thumb]]:rounded-full [&>[data-radix-scroll-area-thumb]]:hover:bg-[hsl(0,0%,40%)]">
                    <div className="min-w-0 p-3 bg-muted/20">
                      <URDFSyntaxHighlighter xml={getModifiedContent()} className="text-xs leading-relaxed" />
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Save to GitHub Dialog */}
        {githubToken && (
          <SaveToGitHubDialog
            isOpen={showSaveToGitHub}
            onClose={() => setShowSaveToGitHub(false)}
            urdfContent={getExportUrdf ? getExportUrdf() : (isEditing ? editedVizUrdf : vizUrdf)}
            meshFiles={meshFiles}
            accessToken={githubToken}
            onSuccess={(repoUrl) => {
              toast.success(`Saved to GitHub! Repository: ${repoUrl}`);
            }}
          />
        )}
      </div>
    </div>
  );

  if (inline) {
    return isOpen ? content : null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        {content}
      </DialogContent>
    </Dialog>
  );
};
