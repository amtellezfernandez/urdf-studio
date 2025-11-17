import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { GitCompare, Copy, Download, Edit2, Save, X, CheckCircle2, AlertCircle, Info, Github } from "lucide-react";
import { toast } from "sonner";
import { URDFSyntaxHighlighter } from "./URDFSyntaxHighlighter";
import { parseURDF } from "@/urdf_corrections/urdfParser";
import { cn } from "@/lib/utils";
import { SaveToGitHubDialog } from "@/components/SaveToGitHubDialog";

interface URDFComparisonProps {
  originalUrdf: string;
  vizUrdf: string;
  isOpen: boolean;
  onClose: () => void;
  onVizUrdfChange?: (newContent: string) => void;
  getExportUrdf?: () => string;
  meshFiles?: Record<string, Blob>;
  githubToken?: string | null;
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
}: URDFComparisonProps) => {
  const [selectedView, setSelectedView] = useState<"original" | "viz" | "split">("split");
  const [isEditing, setIsEditing] = useState(false);
  const [editedVizUrdf, setEditedVizUrdf] = useState(vizUrdf);
  const [showParseInfo, setShowParseInfo] = useState(true);
  const [showSaveToGitHub, setShowSaveToGitHub] = useState(false);

  // Parse URDF content in real-time
  const parseInfo = useMemo(() => {
    const contentToParse = isEditing ? editedVizUrdf : vizUrdf;
    const parsed = parseURDF(contentToParse);
    
    if (!parsed.isValid) {
      return {
        isValid: false,
        error: parsed.error || "Unknown parsing error",
        links: 0,
        joints: 0,
        materials: 0,
      };
    }

    const doc = parsed.document;
    const links = doc.querySelectorAll("link").length;
    const joints = doc.querySelectorAll("joint").length;
    const materials = doc.querySelectorAll("material").length;
    const robotName = doc.querySelector("robot")?.getAttribute("name") || "Unnamed";

    return {
      isValid: true,
      error: null,
      links,
      joints,
      materials,
      robotName,
    };
  }, [isEditing ? editedVizUrdf : vizUrdf, isEditing]);

  // Parse original URDF
  const originalParseInfo = useMemo(() => {
    const parsed = parseURDF(originalUrdf);
    
    if (!parsed.isValid) {
      return {
        isValid: false,
        error: parsed.error || "Unknown parsing error",
        links: 0,
        joints: 0,
        materials: 0,
      };
    }

    const doc = parsed.document;
    const links = doc.querySelectorAll("link").length;
    const joints = doc.querySelectorAll("joint").length;
    const materials = doc.querySelectorAll("material").length;
    const robotName = doc.querySelector("robot")?.getAttribute("name") || "Unnamed";

    return {
      isValid: true,
      error: null,
      links,
      joints,
      materials,
      robotName,
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

  const formattedOriginal = formatXML(originalUrdf);
  const formattedViz = formatXML(isEditing ? editedVizUrdf : vizUrdf);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="w-5 h-5" />
            URDF Editor
          </DialogTitle>
          <DialogDescription>
            View and edit the URDF files. Compare original with modified visualization URDF.
          </DialogDescription>
        </DialogHeader>

        {/* Parsing Status */}
        {showParseInfo && (
          <div className="flex gap-4 p-3 bg-muted/30 rounded-md border border-border/50">
            {/* Original URDF Parse Info */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {originalParseInfo.isValid ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                )}
                <span className="text-xs font-semibold">Original URDF</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 ml-auto"
                  onClick={() => setShowParseInfo(false)}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
              {originalParseInfo.isValid ? (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Robot: <span className="font-mono text-foreground">{originalParseInfo.robotName}</span></div>
                  <div className="flex gap-4">
                    <span>Links: <span className="font-semibold text-foreground">{originalParseInfo.links}</span></span>
                    <span>Joints: <span className="font-semibold text-foreground">{originalParseInfo.joints}</span></span>
                    <span>Materials: <span className="font-semibold text-foreground">{originalParseInfo.materials}</span></span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-red-500">
                  Parse Error: {originalParseInfo.error}
                </div>
              )}
            </div>

            {/* Viz URDF Parse Info */}
            <div className="flex-1 border-l border-border/50 pl-4">
              <div className="flex items-center gap-2 mb-2">
                {parseInfo.isValid ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                )}
                <span className="text-xs font-semibold">Viz URDF</span>
                {isEditing && (
                  <span className="text-[10px] text-muted-foreground ml-2">(editing)</span>
                )}
              </div>
              {parseInfo.isValid ? (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Robot: <span className="font-mono text-foreground">{parseInfo.robotName}</span></div>
                  <div className="flex gap-4">
                    <span>Links: <span className="font-semibold text-foreground">{parseInfo.links}</span></span>
                    <span>Joints: <span className="font-semibold text-foreground">{parseInfo.joints}</span></span>
                    <span>Materials: <span className="font-semibold text-foreground">{parseInfo.materials}</span></span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-red-500">
                  Parse Error: {parseInfo.error}
                </div>
              )}
            </div>
          </div>
        )}

        {!showParseInfo && (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={() => setShowParseInfo(true)}
          >
            <Info className="w-3 h-3 mr-1.5" />
            Show Parse Info
          </Button>
        )}

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* View Toggle */}
          <div className="flex items-center gap-2">
            <Button
              variant={selectedView === "original" ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedView("original")}
              className="text-xs"
            >
              Original
            </Button>
            <Button
              variant={selectedView === "viz" ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedView("viz")}
              className="text-xs"
            >
              Viz URDF
            </Button>
            <Button
              variant={selectedView === "split" ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedView("split")}
              className="text-xs"
            >
              Split View
            </Button>
          </div>

          {/* Content Area */}
          <div className="flex-1 grid gap-4 min-h-0" style={{
            gridTemplateColumns: selectedView === "split" ? "1fr 1fr" : "1fr"
          }}>
            {/* Original URDF */}
            {(selectedView === "original" || selectedView === "split") && (
              <div className="flex flex-col gap-2 min-h-0 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Original URDF</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => copyToClipboard(formattedOriginal, "Original URDF")}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => downloadURDF(formattedOriginal, "original.urdf")}
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <ScrollArea className="flex-1 border rounded-md overflow-hidden">
                  <div className="min-w-0 p-5 bg-muted/40">
                    <URDFSyntaxHighlighter xml={formattedOriginal} className="text-sm leading-relaxed" />
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Viz URDF */}
            {(selectedView === "viz" || selectedView === "split") && (
              <div className="flex flex-col gap-2 min-h-0 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Viz URDF</h3>
                  <div className="flex gap-2">
                    {!isEditing ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => setIsEditing(true)}
                          title="Edit Viz URDF"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => copyToClipboard(formattedViz, "Viz URDF")}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => downloadURDF(isEditing ? editedVizUrdf : vizUrdf, "viz-robot.urdf", true)}
                        >
                          <Download className="w-3 h-3" />
                        </Button>
                        {githubToken && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => setShowSaveToGitHub(true)}
                            title="Save to GitHub"
                          >
                            <Github className="w-3 h-3" />
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          className="h-7 px-2"
                          onClick={handleSave}
                        >
                          <Save className="w-3 h-3 mr-1" />
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={handleCancel}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {isEditing ? (
                  <div className="flex flex-col gap-2 flex-1">
                    {/* Real-time parse status while editing */}
                    {!parseInfo.isValid && (
                      <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/50 rounded-md">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <div className="text-xs text-red-500">
                          <span className="font-semibold">Invalid XML:</span> {parseInfo.error}
                        </div>
                      </div>
                    )}
                    {parseInfo.isValid && (
                      <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/50 rounded-md">
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <div className="text-xs text-green-700 dark:text-green-400">
                          <span className="font-semibold">Valid URDF:</span> {parseInfo.links} links, {parseInfo.joints} joints
                        </div>
                      </div>
                    )}
                    <Textarea
                      value={editedVizUrdf}
                      onChange={(e) => setEditedVizUrdf(e.target.value)}
                      className={cn(
                        "flex-1 font-mono text-xs min-h-[400px]",
                        !parseInfo.isValid && "border-red-500/50 focus-visible:ring-red-500/50"
                      )}
                      placeholder="Edit URDF content..."
                    />
                  </div>
                ) : (
                  <ScrollArea className="flex-1 border rounded-md overflow-hidden">
                    <div className="min-w-0 p-5 bg-muted/40">
                      <URDFSyntaxHighlighter xml={formattedViz} className="text-sm leading-relaxed" />
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
      </DialogContent>
    </Dialog>
  );
};

