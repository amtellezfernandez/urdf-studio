import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useCameraStore } from "@/store/useCameraStore";
import { parseCameraConfig } from "@/features/camera";
import { toast } from "sonner";

interface CameraConfigUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CameraConfigUpload({ open, onOpenChange }: CameraConfigUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadCameras = useCameraStore((state) => state.loadCameras);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const config = parseCameraConfig(content, file.name);

      loadCameras(config);

      toast.success(`Loaded ${config.cameras.length} camera(s) from ${file.name}`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load camera config');
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Upload Camera Config</DialogTitle>
          <DialogDescription className="text-[#a0a0a0]">
            Upload a JSON or YAML file containing camera configurations
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          <div className="border-2 border-dashed border-[#3d3d3d] rounded-lg p-8 text-center">
            <Upload className="mx-auto h-12 w-12 text-[#a0a0a0] mb-4" />
            <p className="text-sm text-[#a0a0a0] mb-4">
              Click to upload a camera configuration file
            </p>
            <p className="text-xs text-[#666] mb-4">
              Supported formats: .json, .yaml, .yml
            </p>
            <Button
              onClick={handleUploadClick}
              className="bg-[#0066cc] hover:bg-[#0052a3] text-white"
            >
              Select File
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.yaml,.yml"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </div>

        <div className="bg-[#2a2a2a] p-3 rounded text-xs text-[#a0a0a0] space-y-1">
          <p className="font-medium text-white mb-2">Expected format:</p>
          <pre className="text-[10px] overflow-x-auto">
{`cameras:
  - name: front_cam
    parent_link: base_link
    pose: [0.15, 0.0, 0.25, 0, 0, 0]
    intrinsics:
      width: 1280
      height: 720
      fov_deg: 90`}
          </pre>
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-[#a0a0a0] hover:text-white hover:bg-[#3d3d3d]"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
