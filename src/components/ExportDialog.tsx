import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Download,
  Copy,
  X,
  FileCode2,
  Github,
  Package,
  FolderOpen,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { convertURDFToXacro } from "@/urdf_corrections/urdfToXacro";
import { convertURDFToMJCF } from "@/urdf_corrections/urdfToMJCF";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  urdfContent: string;
  meshFiles?: Record<string, Blob>;
  githubToken?: string | null;
  robotName?: string;
}

interface ExportData {
  urdf: string;
  xacro: string | null;
  mjcf: string | null;
  xacroStats: { properties: number; macros: number; values: number } | null;
  mjcfStats: { bodies: number; joints: number; geometries: number } | null;
}

export const ExportDialog = ({
  isOpen,
  onClose,
  urdfContent,
  meshFiles = {},
  githubToken,
  robotName = "robot",
}: ExportDialogProps) => {
  const [selectedTab, setSelectedTab] = useState<"xacro" | "mjcf">("xacro");
  const [isGenerating, setIsGenerating] = useState(false);
  const [exportData, setExportData] = useState<ExportData | null>(null);

  // GitHub push selection
  const [githubSelections, setGithubSelections] = useState({
    urdf: true,
    xacro: false,
    mjcf: false,
    meshes: true,
  });

  // Generate exports on demand
  const generateExports = () => {
    setIsGenerating(true);

    try {
      const data: ExportData = {
        urdf: urdfContent,
        xacro: null,
        mjcf: null,
        xacroStats: null,
        mjcfStats: null,
      };

      // Generate Xacro
      const xacroResult = convertURDFToXacro(urdfContent);
      data.xacro = xacroResult.xacroContent;
      data.xacroStats = {
        properties: xacroResult.stats.propertiesGenerated,
        macros: xacroResult.stats.macrosGenerated,
        values: xacroResult.stats.valuesParameterized,
      };

      // Generate MJCF
      const mjcfResult = convertURDFToMJCF(urdfContent);
      data.mjcf = mjcfResult.mjcfContent;
      data.mjcfStats = {
        bodies: mjcfResult.stats.bodiesCreated,
        joints: mjcfResult.stats.jointsConverted,
        geometries: mjcfResult.stats.geometriesConverted,
      };

      setExportData(data);
      toast.success("Export formats generated successfully");
    } catch (error) {
      console.error("Export generation error:", error);
      toast.error("Failed to generate export formats");
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-generate when dialog opens
  useMemo(() => {
    if (isOpen && !exportData) {
      generateExports();
    }
  }, [isOpen]);

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  const copyToClipboard = (content: string, label: string) => {
    navigator.clipboard.writeText(content);
    toast.success(`Copied ${label} to clipboard`);
  };

  const handleDownloadXacro = () => {
    if (exportData?.xacro) {
      downloadFile(exportData.xacro, `${robotName}.urdf.xacro`);
    }
  };

  const handleDownloadMJCF = () => {
    if (exportData?.mjcf) {
      downloadFile(exportData.mjcf, `${robotName}.xml`);
    }
  };

  const handleDownloadURDF = () => {
    downloadFile(urdfContent, `${robotName}.urdf`);
  };

  const handleDownloadAll = async () => {
    // Download all selected formats
    handleDownloadURDF();
    if (exportData?.xacro) {
      handleDownloadXacro();
    }
    if (exportData?.mjcf) {
      handleDownloadMJCF();
    }

    // Download meshes as zip if available
    if (Object.keys(meshFiles).length > 0) {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        const meshFolder = zip.folder("meshes");

        for (const [filename, blob] of Object.entries(meshFiles)) {
          meshFolder?.file(filename, blob);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${robotName}_meshes.zip`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success("Downloaded meshes archive");
      } catch (error) {
        console.error("Failed to create mesh archive:", error);
        toast.error("Failed to download meshes");
      }
    }
  };

  const handleGitHubPush = () => {
    // This will open the GitHub dialog with selected files
    const selectedFiles: string[] = [];
    if (githubSelections.urdf) selectedFiles.push("URDF");
    if (githubSelections.xacro && exportData?.xacro) selectedFiles.push("Xacro");
    if (githubSelections.mjcf && exportData?.mjcf) selectedFiles.push("MJCF");
    if (githubSelections.meshes && Object.keys(meshFiles).length > 0) selectedFiles.push("Meshes");

    if (selectedFiles.length === 0) {
      toast.error("Please select at least one file type to push");
      return;
    }

    toast.info(`Ready to push: ${selectedFiles.join(", ")}`);
    // TODO: Integrate with SaveToGitHubDialog
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg max-w-5xl w-full max-h-[85vh] flex flex-col m-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Package className="w-5 h-5" />
              Export Robot Description
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Convert and export your URDF to different formats
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
          {isGenerating ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Generating export formats...</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as "xacro" | "mjcf")} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
                  <TabsTrigger value="xacro" className="text-xs">
                    <FileCode2 className="w-3 h-3 mr-1.5" />
                    Xacro Format
                  </TabsTrigger>
                  <TabsTrigger value="mjcf" className="text-xs">
                    <FileCode2 className="w-3 h-3 mr-1.5" />
                    MJCF (MuJoCo)
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="xacro" className="flex-1 flex flex-col min-h-0 mt-4 overflow-hidden data-[state=inactive]:hidden">
                  <div className="flex items-center justify-between mb-2 flex-shrink-0">
                    <div>
                      <h4 className="text-sm font-medium">Xacro Output</h4>
                      {exportData?.xacroStats && (
                        <p className="text-xs text-muted-foreground">
                          {exportData.xacroStats.properties} properties •{" "}
                          {exportData.xacroStats.macros} macros •{" "}
                          {exportData.xacroStats.values} values parametrized
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          exportData?.xacro && copyToClipboard(exportData.xacro, "Xacro")
                        }
                        disabled={!exportData?.xacro}
                      >
                        <Copy className="w-3 h-3 mr-1.5" />
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleDownloadXacro}
                        disabled={!exportData?.xacro}
                      >
                        <Download className="w-3 h-3 mr-1.5" />
                        Download .xacro
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 border rounded-md min-h-0 overflow-auto bg-muted/30">
                    <pre className="text-xs font-mono p-4 whitespace-pre">
                      {exportData?.xacro || "Generating..."}
                    </pre>
                  </div>
                </TabsContent>

                <TabsContent value="mjcf" className="flex-1 flex flex-col min-h-0 mt-4 overflow-hidden data-[state=inactive]:hidden">
                  <div className="flex items-center justify-between mb-2 flex-shrink-0">
                    <div>
                      <h4 className="text-sm font-medium">MJCF Output (MuJoCo)</h4>
                      {exportData?.mjcfStats && (
                        <p className="text-xs text-muted-foreground">
                          {exportData.mjcfStats.bodies} bodies •{" "}
                          {exportData.mjcfStats.joints} joints •{" "}
                          {exportData.mjcfStats.geometries} geometries
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          exportData?.mjcf && copyToClipboard(exportData.mjcf, "MJCF")
                        }
                        disabled={!exportData?.mjcf}
                      >
                        <Copy className="w-3 h-3 mr-1.5" />
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleDownloadMJCF}
                        disabled={!exportData?.mjcf}
                      >
                        <Download className="w-3 h-3 mr-1.5" />
                        Download .xml
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 border rounded-md min-h-0 overflow-auto bg-muted/30">
                    <pre className="text-xs font-mono p-4 whitespace-pre">
                      {exportData?.mjcf || "Generating..."}
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>

        {/* Footer with GitHub Push Options */}
        <div className="border-t p-4 space-y-3 flex-shrink-0">
          {/* Download Actions Row */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">Quick Actions:</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleDownloadURDF}
            >
              <Download className="w-3 h-3 mr-1.5" />
              Download URDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleDownloadAll}
            >
              <FolderOpen className="w-3 h-3 mr-1.5" />
              Download All
            </Button>
          </div>

          {/* GitHub Push Row */}
          {githubToken && (
            <div className="flex items-center justify-between pt-2 border-t border-border/30">
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <span className="font-medium text-muted-foreground">Push to GitHub:</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={githubSelections.urdf}
                    onCheckedChange={(checked) =>
                      setGithubSelections((prev) => ({ ...prev, urdf: checked as boolean }))
                    }
                  />
                  <span>URDF</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={githubSelections.xacro}
                    onCheckedChange={(checked) =>
                      setGithubSelections((prev) => ({ ...prev, xacro: checked as boolean }))
                    }
                    disabled={!exportData?.xacro}
                  />
                  <span>Xacro</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={githubSelections.mjcf}
                    onCheckedChange={(checked) =>
                      setGithubSelections((prev) => ({ ...prev, mjcf: checked as boolean }))
                    }
                    disabled={!exportData?.mjcf}
                  />
                  <span>MJCF</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={githubSelections.meshes}
                    onCheckedChange={(checked) =>
                      setGithubSelections((prev) => ({ ...prev, meshes: checked as boolean }))
                    }
                    disabled={Object.keys(meshFiles).length === 0}
                  />
                  <span>Meshes ({Object.keys(meshFiles).length})</span>
                </label>
              </div>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs flex-shrink-0"
                onClick={handleGitHubPush}
              >
                <Github className="w-3 h-3 mr-1.5" />
                Push Selected
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
