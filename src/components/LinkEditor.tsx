import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { Search, X, Plus, Trash2, Calculator, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { parseLinkData, type LinkData } from "@/urdf_corrections/parseLinkData";
import { 
  addVisualToLink, 
  addCollisionToLink, 
  addInertialToLink,
  updateVisualInLink,
  updateCollisionInLink,
  updateInertialInLink,
  removeVisualFromLink,
  removeCollisionFromLink,
  removeInertialFromLink
} from "@/urdf_corrections/updateLinkData";
import { 
  computeMeshBounds, 
  computePCA, 
  computeRotationToAxis,
  findMeshFile 
} from "@/urdf_corrections/computeMeshGeometry";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Collision visibility state type
export interface CollisionVisibility {
  [linkName: string]: {
    [collisionIndex: number]: boolean;
  };
}

interface LinkEditorProps {
  urdfContent?: string;
  onMaterialChange?: (linkName: string, materialName: string, color: string) => void;
  onLinkNameChange?: (oldName: string, newName: string) => void;
  onUrdfChange?: (newContent: string) => void;
  selectedLink?: string | null;
  onLinkSelect?: (linkName: string | null) => void;
  meshFiles?: Record<string, Blob>;
  collisionVisibility?: CollisionVisibility;
  onCollisionVisibilityChange?: (visibility: CollisionVisibility) => void;
}

export const LinkEditor = ({
  urdfContent,
  onMaterialChange,
  onLinkNameChange,
  onUrdfChange,
  selectedLink,
  onLinkSelect,
  meshFiles = {},
  collisionVisibility = {},
  onCollisionVisibilityChange,
}: LinkEditorProps) => {
  const [searchQuery, setSearchQuery] = useState("");

  // Parse all links from URDF
  const links = useMemo((): LinkData[] => {
    if (!urdfContent) return [];

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        return [];
      }

      const robot = xmlDoc.querySelector("robot");
      if (!robot) {
        return [];
      }

      const linkElements = xmlDoc.querySelectorAll("link");
      const linkData: LinkData[] = [];

      linkElements.forEach((link) => {
        const name = link.getAttribute("name");
        if (!name) return;

        const data = parseLinkData(urdfContent, name);
        if (data) {
          linkData.push(data);
        }
      });

      return linkData.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error("Error parsing links:", error);
      return [];
    }
  }, [urdfContent]);

  // Filter links by search query
  const filteredLinks = useMemo(() => {
    if (!searchQuery.trim()) return links;
    const query = searchQuery.toLowerCase();
    return links.filter((link) => link.name.toLowerCase().includes(query));
  }, [links, searchQuery]);

  return (
    <div className="flex flex-col w-full">
      {/* Header Controls */}
      <div className="flex-shrink-0 space-y-2 p-3 border-b border-border/30">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search links..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 pr-8 text-xs bg-input border-border"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center hover:bg-muted/50 rounded"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Stats */}
        {links.length > 0 && (
          <div className="text-[10px] text-muted-foreground px-1">
            {filteredLinks.length} of {links.length} links
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        )}
      </div>

      {/* Links List */}
      <div className="flex-1 p-2 px-3">
        {links.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No links loaded
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No links found
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLinks.map((link) => (
                <LinkControl
                  key={link.name}
                  linkData={link}
                  urdfContent={urdfContent}
                  onMaterialChange={onMaterialChange}
                  onLinkNameChange={onLinkNameChange}
                  onUrdfChange={onUrdfChange}
                  meshFiles={meshFiles}
                  isHighlighted={selectedLink === link.name}
                  onSelect={() => onLinkSelect?.(link.name)}
                  collisionVisibility={collisionVisibility[link.name] || {}}
                  onCollisionVisibilityChange={(index, visible) => {
                    const newVisibility = {
                      ...collisionVisibility,
                      [link.name]: {
                        ...(collisionVisibility[link.name] || {}),
                        [index]: visible,
                      },
                    };
                    onCollisionVisibilityChange?.(newVisibility);
                  }}
                />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface LinkControlProps {
  linkData: LinkData;
  urdfContent?: string;
  onMaterialChange?: (linkName: string, materialName: string, color: string) => void;
  onLinkNameChange?: (oldName: string, newName: string) => void;
  onUrdfChange?: (newContent: string) => void;
  meshFiles?: Record<string, Blob>;
  isHighlighted?: boolean;
  onSelect?: () => void;
  collisionVisibility?: { [index: number]: boolean };
  onCollisionVisibilityChange?: (index: number, visible: boolean) => void;
}

const LinkControl = ({
  linkData,
  urdfContent,
  onMaterialChange,
  onLinkNameChange,
  onUrdfChange,
  meshFiles = {},
  isHighlighted,
  onSelect,
  collisionVisibility = {},
  onCollisionVisibilityChange,
}: LinkControlProps) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(linkData.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditedName(linkData.name);
  }, [linkData.name]);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleNameDoubleClick = () => {
    if (onLinkNameChange) {
      setIsEditingName(true);
    }
  };

  const handleNameBlur = () => {
    if (onLinkNameChange && editedName.trim() && editedName !== linkData.name) {
      onLinkNameChange(linkData.name, editedName.trim());
    } else {
      setEditedName(linkData.name);
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setEditedName(linkData.name);
      setIsEditingName(false);
    }
  };

  // Visual is always mesh - no need to add more visuals

  const handleAddCollision = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = addCollisionToLink(
      urdfContent,
      linkData.name,
      "box",
      { size: "1 1 1" },
      { xyz: [0, 0, 0], rpy: [0, 0, 0] }
    );
    onUrdfChange(newContent);
    toast.success("Collision added");
  };

  const handleAddInertial = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = addInertialToLink(
      urdfContent,
      linkData.name,
      1.0,
      { ixx: 0.01, ixy: 0, ixz: 0, iyy: 0.01, iyz: 0, izz: 0.01 },
      { xyz: [0, 0, 0], rpy: [0, 0, 0] }
    );
    onUrdfChange(newContent);
    toast.success("Inertial added");
  };

  const handleRemoveVisual = (index: number) => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = removeVisualFromLink(urdfContent, linkData.name, index);
    onUrdfChange(newContent);
    toast.success("Visual removed");
  };

  const handleRemoveCollision = (index: number) => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = removeCollisionFromLink(urdfContent, linkData.name, index);
    onUrdfChange(newContent);
    toast.success("Collision removed");
  };

  const handleRemoveInertial = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = removeInertialFromLink(urdfContent, linkData.name);
    onUrdfChange(newContent);
    toast.success("Inertial removed");
  };

  return (
    <div
      className={cn(
        "border border-border/20 rounded-sm bg-muted/10 mb-1",
        isHighlighted && "ring-2 ring-primary/50"
      )}
      onMouseEnter={onSelect}
    >
      <BlenderPanel 
        title={
          isEditingName ? (
            <Input
              ref={nameInputRef}
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={handleNameKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="h-5 text-xs px-1 bg-input border-border text-foreground"
              placeholder="Link name"
            />
          ) : (
            <span
              className={cn(
                "text-xs font-semibold cursor-text hover:text-primary transition-colors truncate text-left block",
                isHighlighted ? "text-primary" : "text-foreground"
              )}
              onDoubleClick={handleNameDoubleClick}
              title={onLinkNameChange ? "Double-click to rename" : undefined}
            >
              {linkData.name}
            </span>
          )
        }
        defaultOpen={false}
      >
        {/* Visual Section - Always mesh for mesh-based robots */}
        <BlenderPanel title="Visual" defaultOpen={true}>
          <div className="space-y-1">
            {linkData.visuals.length === 0 ? (
              <div className="text-[10px] text-muted-foreground/70 pb-2">
                No visual element found
              </div>
            ) : (
              linkData.visuals.map((visual, index) => (
                <VisualControl
                  key={index}
                  linkName={linkData.name}
                  visual={visual}
                  index={index}
                  linkData={linkData}
                  urdfContent={urdfContent}
                  onMaterialChange={onMaterialChange}
                  onUrdfChange={onUrdfChange}
                  onRemove={() => handleRemoveVisual(index)}
                />
              ))
            )}
          </div>
        </BlenderPanel>

        {/* Collision Section - Can have mesh or primitives */}
        <BlenderPanel title="Collision" defaultOpen={true}>
          <div className="space-y-1">
            {linkData.collisions.length === 0 ? (
              <div className="text-[10px] text-muted-foreground/70 pb-2">
                No collision elements
                {onUrdfChange && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] ml-2"
                    onClick={handleAddCollision}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Collision Shape
                  </Button>
                )}
              </div>
            ) : (
              <>
                {linkData.collisions.map((collision, index) => (
                  <CollisionControl
                    key={index}
                    linkName={linkData.name}
                    collision={collision}
                    index={index}
                    linkData={linkData}
                    urdfContent={urdfContent}
                    onUrdfChange={onUrdfChange}
                    meshFiles={meshFiles}
                    onRemove={() => handleRemoveCollision(index)}
                    isVisible={collisionVisibility[index] ?? false}
                    onVisibilityChange={(visible) => onCollisionVisibilityChange?.(index, visible)}
                  />
                ))}
                {onUrdfChange && (
                  <div className="pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] w-full"
                      onClick={handleAddCollision}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add Collision Primitive
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </BlenderPanel>

        {/* Inertial Section */}
        <BlenderPanel title="Inertial (Advanced)" defaultOpen={false}>
          <div className="space-y-1">
            {!linkData.inertial ? (
              <div className="text-[10px] text-muted-foreground/70 pb-2">
                No inertial element
                {onUrdfChange && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] ml-2"
                    onClick={handleAddInertial}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Inertial
                  </Button>
                )}
              </div>
            ) : (
              <>
                <InertialControl
                  linkName={linkData.name}
                  inertial={linkData.inertial}
                  urdfContent={urdfContent}
                  onUrdfChange={onUrdfChange}
                />
                {onUrdfChange && (
                  <div className="pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-destructive w-full"
                      onClick={handleRemoveInertial}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Remove Inertial
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </BlenderPanel>
      </BlenderPanel>
    </div>
  );
};

// Visual Control Component
interface VisualControlProps {
  linkName: string;
  visual: any;
  index: number;
  linkData: LinkData;
  urdfContent?: string;
  onMaterialChange?: (linkName: string, materialName: string, color: string) => void;
  onUrdfChange?: (newContent: string) => void;
  onRemove: () => void;
}

const VisualControl = ({ linkName, visual, index, linkData, urdfContent, onMaterialChange, onUrdfChange, onRemove }: VisualControlProps) => {
  // Visual is always mesh for mesh-based robots
  const [geometryParams, setGeometryParams] = useState(visual.geometry.params || { filename: "", scale: "1 1 1" });
  const [origin, setOrigin] = useState(visual.origin);
  const [currentColor, setCurrentColor] = useState(visual.materialColor || "#cccccc");

  useEffect(() => {
    setGeometryParams(visual.geometry.params || { filename: "", scale: "1 1 1" });
    setOrigin(visual.origin);
    setCurrentColor(visual.materialColor || "#cccccc");
  }, [visual]);

  const updateURDF = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateVisualInLink(
      urdfContent,
      linkName,
      index,
      "mesh", // Always mesh for visual
      geometryParams,
      origin,
      currentColor
    );
    onUrdfChange(newContent);
  };

  const handleParamChange = (key: string, value: string) => {
    setGeometryParams({ ...geometryParams, [key]: value });
    setTimeout(updateURDF, 0);
  };

  const handleOriginChange = (field: "xyz" | "rpy", index: number, value: number) => {
    const newOrigin = { ...origin };
    newOrigin[field][index] = value;
    setOrigin(newOrigin);
    setTimeout(updateURDF, 0);
  };

  const handleColorChange = (newColor: string) => {
    setCurrentColor(newColor);
    if (onMaterialChange) {
      const materialName = `material_${linkName}`;
      onMaterialChange(linkName, materialName, newColor);
    }
    setTimeout(updateURDF, 0);
  };

  const parseSize = (sizeStr: string): [number, number, number] => {
    const parts = sizeStr.split(" ").map(parseFloat);
    return [parts[0] || 1, parts[1] || 1, parts[2] || 1];
  };

  const formatSize = (size: [number, number, number]): string => {
    return `${size[0]} ${size[1]} ${size[2]}`;
  };

  const title = linkData.visuals.length === 1 ? "Visual (Mesh)" : `Visual ${index + 1} (Mesh)`;
  
  return (
    <BlenderPanel title={title} defaultOpen={true} className="mb-1">
      <div className="space-y-1">
        <BlenderPropertyRow label="Filename">
          <Input
            value={geometryParams.filename || ""}
            onChange={(e) => handleParamChange("filename", e.target.value)}
            className="h-7 text-xs"
            placeholder="meshes/model.stl"
          />
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Scale">
          <div className="flex items-center gap-1">
            {parseSize(geometryParams.scale || "1 1 1").map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => {
                  const scale = parseSize(geometryParams.scale || "1 1 1");
                  scale[i] = newVal;
                  handleParamChange("scale", formatSize(scale));
                }}
                step={0.0001}
                min={0.0001}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin XYZ">
          <div className="flex items-center gap-1">
            {origin.xyz.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("xyz", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <div className="flex items-center gap-1">
            {origin.rpy.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("rpy", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        {onMaterialChange && (
          <BlenderPropertyRow label="Color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentColor}
                onChange={(e) => handleColorChange(e.target.value)}
                className="h-7 w-16 cursor-pointer rounded border border-border bg-input"
              />
              <Input
                type="text"
                value={currentColor}
                onChange={(e) => {
                  const newColor = e.target.value;
                  if (/^#[0-9A-Fa-f]{6}$/.test(newColor)) {
                    handleColorChange(newColor);
                  } else {
                    setCurrentColor(newColor);
                  }
                }}
                className="h-7 w-20 text-xs font-mono"
                placeholder="#cccccc"
              />
            </div>
          </BlenderPropertyRow>
        )}
      </div>
    </BlenderPanel>
  );
};

// Collision Control Component
interface CollisionControlProps {
  linkName: string;
  collision: any;
  index: number;
  urdfContent?: string;
  onUrdfChange?: (newContent: string) => void;
  onRemove: () => void;
  linkData: LinkData;
  meshFiles?: Record<string, Blob>;
  isVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

const CollisionControl = ({ linkName, collision, index, linkData, urdfContent, onUrdfChange, meshFiles = {}, onRemove, isVisible = false, onVisibilityChange }: CollisionControlProps) => {
  const [geometryType, setGeometryType] = useState<"box" | "sphere" | "cylinder" | "mesh">(collision.geometry.type || "box");
  const [geometryParams, setGeometryParams] = useState(collision.geometry.params || {});
  const [origin, setOrigin] = useState(collision.origin);
  const [isComputing, setIsComputing] = useState(false);

  // Get visual mesh info for auto-filling
  const visualMeshInfo = useMemo(() => {
    if (linkData.visuals.length === 0) return null;
    const visual = linkData.visuals[0];
    if (visual.geometry.type !== "mesh") return null;
    return {
      filename: visual.geometry.params.filename || "",
      scale: visual.geometry.params.scale || "1 1 1",
    };
  }, [linkData.visuals]);

  // Track collision data changes to reload form when collision changes
  const collisionKey = useMemo(() => {
    return `${linkName}-${index}-${collision.geometry.type}-${JSON.stringify(collision.geometry.params)}-${JSON.stringify(collision.origin)}`;
  }, [linkName, index, collision.geometry.type, collision.geometry.params, collision.origin]);

  useEffect(() => {
    // Reload form when collision data changes
    setGeometryType(collision.geometry.type || "box");
    setGeometryParams(collision.geometry.params || {});
    setOrigin(collision.origin);
  }, [collisionKey]);

  const updateURDF = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateCollisionInLink(
      urdfContent,
      linkName,
      index,
      geometryType,
      geometryParams,
      origin
    );
    onUrdfChange(newContent);
  };

  const handleGeometryTypeChange = async (newType: "box" | "sphere" | "cylinder" | "mesh") => {
    // Clear previous params and set new defaults based on type
    let newParams: Record<string, string> = {};
    let newOrigin = { xyz: [0, 0, 0] as [number, number, number], rpy: [0, 0, 0] as [number, number, number] };
    
    // If mesh type, copy from visual
    if (newType === "mesh" && visualMeshInfo) {
      newParams = {
        filename: visualMeshInfo.filename,
        scale: visualMeshInfo.scale,
      };
      newOrigin = linkData.visuals[0].origin;
    } else if (newType === "box") {
      // For box, keep existing size if valid, otherwise default
      newParams = { size: (geometryType === "box" && geometryParams.size) ? geometryParams.size : "1 1 1" };
    } else if (newType === "sphere") {
      newParams = { radius: (geometryType === "sphere" && geometryParams.radius) ? geometryParams.radius : "1" };
    } else if (newType === "cylinder") {
      newParams = { 
        radius: (geometryType === "cylinder" && geometryParams.radius) ? geometryParams.radius : "1",
        length: (geometryType === "cylinder" && geometryParams.length) ? geometryParams.length : "1"
      };
    }
    
    // Update state
    setGeometryType(newType);
    setGeometryParams(newParams);
    setOrigin(newOrigin);
    
    // Update URDF immediately with new values (don't rely on state which is async)
    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateCollisionInLink(
      urdfContent,
      linkName,
      index,
      newType,
      newParams,
      newOrigin
    );
    onUrdfChange(newContent);
  };

  const handleAutoFill = async (type: "box" | "sphere" | "cylinder" | "capsule") => {
    if (!visualMeshInfo || !onUrdfChange) {
      toast.error("No visual mesh found");
      return;
    }

    setIsComputing(true);
    try {
      const meshFile = findMeshFile(visualMeshInfo.filename, meshFiles);
      if (!meshFile) {
        toast.error("Mesh file not found");
        setIsComputing(false);
        return;
      }

      const bounds = await computeMeshBounds(meshFile, visualMeshInfo.scale);
      if (!bounds) {
        toast.error("Failed to compute mesh bounds");
        setIsComputing(false);
        return;
      }

      let newGeometryType: "box" | "sphere" | "cylinder" | "mesh";
      let newGeometryParams: Record<string, string> = {};
      let newOrigin: { xyz: [number, number, number]; rpy: [number, number, number] } = { xyz: [0, 0, 0], rpy: [0, 0, 0] };

      if (type === "box") {
        // Axis-aligned bounding box
        newGeometryType = "box";
        newGeometryParams = {
          size: `${bounds.size[0]} ${bounds.size[1]} ${bounds.size[2]}`,
        };
        newOrigin = {
          xyz: bounds.center,
          rpy: [0, 0, 0],
        };
      } else if (type === "sphere") {
        // Minimum bounding sphere (centroid-based)
        const centroid = bounds.center;
        let maxDist = 0;
        const vertexCount = bounds.vertices.length / 3;
        for (let i = 0; i < vertexCount; i++) {
          const dx = bounds.vertices[i * 3] - centroid[0];
          const dy = bounds.vertices[i * 3 + 1] - centroid[1];
          const dz = bounds.vertices[i * 3 + 2] - centroid[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          maxDist = Math.max(maxDist, dist);
        }
        newGeometryType = "sphere";
        newGeometryParams = {
          radius: String(maxDist),
        };
        newOrigin = {
          xyz: centroid,
          rpy: [0, 0, 0],
        };
      } else if (type === "cylinder" || type === "capsule") {
        // PCA-based cylinder fitting
        const pca = computePCA(bounds.vertices);
        if (!pca) {
          toast.error("Failed to compute PCA");
          setIsComputing(false);
          return;
        }

        const axis = pca.axis;
        const centroid = pca.centroid;
        
        // Project vertices onto principal axis
        const vertexCount = bounds.vertices.length / 3;
        let minT = Infinity;
        let maxT = -Infinity;
        let maxRadius = 0;

        for (let i = 0; i < vertexCount; i++) {
          const x = bounds.vertices[i * 3] - centroid[0];
          const y = bounds.vertices[i * 3 + 1] - centroid[1];
          const z = bounds.vertices[i * 3 + 2] - centroid[2];
          
          // Project onto axis
          const t = x * axis[0] + y * axis[1] + z * axis[2];
          minT = Math.min(minT, t);
          maxT = Math.max(maxT, t);
          
          // Compute orthogonal distance
          const projX = t * axis[0];
          const projY = t * axis[1];
          const projZ = t * axis[2];
          const orthoX = x - projX;
          const orthoY = y - projY;
          const orthoZ = z - projZ;
          const radius = Math.sqrt(orthoX * orthoX + orthoY * orthoY + orthoZ * orthoZ);
          maxRadius = Math.max(maxRadius, radius);
        }

        const height = maxT - minT;
        const rotation = computeRotationToAxis(axis);

        newGeometryType = "cylinder";
        newGeometryParams = {
          radius: String(maxRadius),
          length: String(height),
        };
        newOrigin = {
          xyz: centroid,
          rpy: rotation.rpy,
        };

        if (type === "capsule") {
          toast.info("Capsule approximated as cylinder in URDF");
        }
      }

      setGeometryType(newGeometryType);
      setGeometryParams(newGeometryParams);
      setOrigin(newOrigin);
      
      const newContent = updateCollisionInLink(
        urdfContent!,
        linkName,
        index,
        newGeometryType,
        newGeometryParams,
        newOrigin
      );
      onUrdfChange(newContent);
      toast.success(`${type === "capsule" ? "Capsule" : type.charAt(0).toUpperCase() + type.slice(1)} auto-filled from mesh`);
    } catch (error) {
      console.error("Error auto-filling collision:", error);
      toast.error("Failed to auto-fill collision");
    } finally {
      setIsComputing(false);
    }
  };

  const handleParamChange = (key: string, value: string) => {
    setGeometryParams({ ...geometryParams, [key]: value });
    setTimeout(updateURDF, 0);
  };

  const handleOriginChange = (field: "xyz" | "rpy", index: number, value: number) => {
    const newOrigin = { ...origin };
    newOrigin[field][index] = value;
    setOrigin(newOrigin);
    setTimeout(updateURDF, 0);
  };

  const parseSize = (sizeStr: string): [number, number, number] => {
    const parts = sizeStr.split(" ").map(parseFloat);
    return [parts[0] || 1, parts[1] || 1, parts[2] || 1];
  };

  const formatSize = (size: [number, number, number]): string => {
    return `${size[0]} ${size[1]} ${size[2]}`;
  };

  return (
    <BlenderPanel 
      title={
        <div className="flex items-center justify-between w-full pr-2">
          <span>Collision {index + 1}</span>
          {onVisibilityChange && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVisibilityChange(!isVisible);
              }}
              className="h-5 w-5 flex items-center justify-center hover:bg-muted/50 rounded transition-colors flex-shrink-0"
              title={isVisible ? "Hide collision in visualizer" : "Show collision in visualizer"}
            >
              {isVisible ? (
                <Eye className="w-3.5 h-3.5 text-primary" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      } 
      defaultOpen={false} 
      className="mb-1"
    >
      <div className="space-y-1">
        <BlenderPropertyRow label="Geometry Type">
          <Select value={geometryType} onValueChange={handleGeometryTypeChange}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="box">Box</SelectItem>
              <SelectItem value="sphere">Sphere</SelectItem>
              <SelectItem value="cylinder">Cylinder</SelectItem>
              <SelectItem value="mesh">Mesh</SelectItem>
            </SelectContent>
          </Select>
        </BlenderPropertyRow>

        {/* Always show calculate buttons for current geometry type when visual mesh is available */}
        {visualMeshInfo && geometryType === "box" && (
          <div className="mb-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] w-full"
              onClick={() => handleAutoFill("box")}
              disabled={isComputing}
            >
              <Calculator className="w-3 h-3 mr-1" />
              Calculate from Mesh
            </Button>
          </div>
        )}
        {visualMeshInfo && geometryType === "sphere" && (
          <div className="mb-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] w-full"
              onClick={() => handleAutoFill("sphere")}
              disabled={isComputing}
            >
              <Calculator className="w-3 h-3 mr-1" />
              Calculate from Mesh
            </Button>
          </div>
        )}
        {visualMeshInfo && geometryType === "cylinder" && (
          <div className="mb-1 space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] w-full"
              onClick={() => handleAutoFill("cylinder")}
              disabled={isComputing}
            >
              <Calculator className="w-3 h-3 mr-1" />
              Calculate from Mesh (Cylinder)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] w-full"
              onClick={() => handleAutoFill("capsule")}
              disabled={isComputing}
            >
              <Calculator className="w-3 h-3 mr-1" />
              Calculate from Mesh (Capsule)
            </Button>
          </div>
        )}

        {geometryType === "box" && (
          <BlenderPropertyRow label="Size">
            <div className="flex items-center gap-1">
              {parseSize(geometryParams.size || "1 1 1").map((val, i) => (
                <NumberInput
                  key={i}
                  value={val}
                  onValueChange={(newVal) => {
                    const size = parseSize(geometryParams.size || "1 1 1");
                    size[i] = newVal;
                    handleParamChange("size", formatSize(size));
                  }}
                  step={0.01}
                  min={0.001}
                  compact
                  className="w-16"
                />
              ))}
            </div>
          </BlenderPropertyRow>
        )}

        {geometryType === "sphere" && (
          <BlenderPropertyRow label="Radius">
            <NumberInput
              value={parseFloat(geometryParams.radius || "1")}
              onValueChange={(val) => handleParamChange("radius", String(val))}
              step={0.01}
              min={0.001}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>
        )}

        {geometryType === "cylinder" && (
          <>
            <BlenderPropertyRow label="Radius">
              <NumberInput
                value={parseFloat(geometryParams.radius || "1")}
                onValueChange={(val) => handleParamChange("radius", String(val))}
                step={0.01}
                min={0.001}
                compact
                className="w-20"
              />
            </BlenderPropertyRow>
            <BlenderPropertyRow label="Length">
              <NumberInput
                value={parseFloat(geometryParams.length || "1")}
                onValueChange={(val) => handleParamChange("length", String(val))}
                step={0.01}
                min={0.001}
                compact
                className="w-20"
              />
            </BlenderPropertyRow>
          </>
        )}

        {geometryType === "mesh" && (
          <>
            <BlenderPropertyRow label="Filename">
              <Input
                value={geometryParams.filename || ""}
                onChange={(e) => handleParamChange("filename", e.target.value)}
                className="h-7 text-xs"
                placeholder="model.stl"
              />
            </BlenderPropertyRow>
            <BlenderPropertyRow label="Scale">
              <div className="flex items-center gap-1">
                {parseSize(geometryParams.scale || "1 1 1").map((val, i) => (
                  <NumberInput
                    key={i}
                    value={val}
                    onValueChange={(newVal) => {
                      const scale = parseSize(geometryParams.scale || "1 1 1");
                      scale[i] = newVal;
                      handleParamChange("scale", formatSize(scale));
                    }}
                    step={0.01}
                    min={0.001}
                    compact
                    className="w-16"
                  />
                ))}
              </div>
            </BlenderPropertyRow>
          </>
        )}

        <BlenderPropertyRow label="Origin XYZ">
          <div className="flex items-center gap-1">
            {origin.xyz.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("xyz", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <div className="flex items-center gap-1">
            {origin.rpy.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("rpy", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        {onUrdfChange && (
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-destructive w-full"
              onClick={onRemove}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Remove Collision
            </Button>
          </div>
        )}
      </div>
    </BlenderPanel>
  );
};

// Inertial Control Component
interface InertialControlProps {
  linkName: string;
  inertial: any;
  urdfContent?: string;
  onUrdfChange?: (newContent: string) => void;
}

// Validate inertia tensor (must be symmetric and positive definite)
function validateInertia(inertia: { ixx: number; ixy: number; ixz: number; iyy: number; iyz: number; izz: number }): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check symmetry (already symmetric by definition, but verify)
  // Check positive definiteness: diagonal elements must be positive
  if (inertia.ixx <= 0) errors.push("Ixx must be positive");
  if (inertia.iyy <= 0) errors.push("Iyy must be positive");
  if (inertia.izz <= 0) errors.push("Izz must be positive");
  
  // Check determinant conditions for positive definiteness
  // For a 3x3 symmetric matrix to be positive definite:
  // 1. All diagonal elements > 0 (checked above)
  // 2. Determinant of all principal minors > 0
  const det2x2_xy = inertia.ixx * inertia.iyy - inertia.ixy * inertia.ixy;
  const det2x2_xz = inertia.ixx * inertia.izz - inertia.ixz * inertia.ixz;
  const det2x2_yz = inertia.iyy * inertia.izz - inertia.iyz * inertia.iyz;
  
  if (det2x2_xy <= 0) errors.push("Ixx*Iyy - Ixy² must be positive");
  if (det2x2_xz <= 0) errors.push("Ixx*Izz - Ixz² must be positive");
  if (det2x2_yz <= 0) errors.push("Iyy*Izz - Iyz² must be positive");
  
  // Full 3x3 determinant
  const det3x3 = 
    inertia.ixx * (inertia.iyy * inertia.izz - inertia.iyz * inertia.iyz) -
    inertia.ixy * (inertia.ixy * inertia.izz - inertia.ixz * inertia.iyz) +
    inertia.ixz * (inertia.ixy * inertia.iyz - inertia.iyy * inertia.ixz);
  
  if (det3x3 <= 0) errors.push("Full inertia matrix determinant must be positive");
  
  return { isValid: errors.length === 0, errors };
}

const InertialControl = ({ linkName, inertial, urdfContent, onUrdfChange }: InertialControlProps) => {
  const [mass, setMass] = useState(inertial.mass);
  const [origin, setOrigin] = useState(inertial.origin);
  const [inertia, setInertia] = useState(inertial.inertia);

  useEffect(() => {
    setMass(inertial.mass);
    setOrigin(inertial.origin);
    setInertia(inertial.inertia);
  }, [inertial]);

  const validation = useMemo(() => validateInertia(inertia), [inertia]);

  const updateURDF = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateInertialInLink(
      urdfContent,
      linkName,
      mass,
      inertia,
      origin
    );
    onUrdfChange(newContent);
  };

  const handleMassChange = (newMass: number) => {
    setMass(newMass);
    setTimeout(updateURDF, 0);
  };

  const handleOriginChange = (field: "xyz" | "rpy", index: number, value: number) => {
    const newOrigin = { ...origin };
    newOrigin[field][index] = value;
    setOrigin(newOrigin);
    setTimeout(updateURDF, 0);
  };

  const handleInertiaChange = (key: keyof typeof inertia, value: number) => {
    setInertia({ ...inertia, [key]: value });
    setTimeout(updateURDF, 0);
  };

  const handleComputeFromMesh = () => {
    // TODO: Implement mesh-based inertia computation
    toast.info("Mesh-based inertia computation coming soon");
  };

  const inertiaTooltips: Record<string, string> = {
    ixx: "Moment of inertia about X-axis (rotation around X)",
    ixy: "Product of inertia (XY coupling term)",
    ixz: "Product of inertia (XZ coupling term)",
    iyy: "Moment of inertia about Y-axis (rotation around Y)",
    iyz: "Product of inertia (YZ coupling term)",
    izz: "Moment of inertia about Z-axis (rotation around Z)",
  };

  return (
    <TooltipProvider>
      <div className="space-y-1">
        <BlenderPropertyRow label="Mass">
          <NumberInput
            value={mass}
            onValueChange={handleMassChange}
            step={0.01}
            min={0.001}
            compact
            className="w-20"
          />
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin XYZ">
          <div className="flex items-center gap-1">
            {origin.xyz.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("xyz", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <div className="flex items-center gap-1">
            {origin.rpy.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("rpy", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        {/* Inertia Tensor Matrix */}
        <div className="space-y-1 pt-1 border-t border-border/20">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Inertia Tensor</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={handleComputeFromMesh}
              title="Compute inertia from mesh geometry"
            >
              <Calculator className="w-3 h-3 mr-1" />
              Compute from Mesh
            </Button>
          </div>

          {!validation.isValid && (
            <div className="mb-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-[10px] text-destructive">
              <div className="flex items-center gap-1 mb-1">
                <AlertTriangle className="w-3 h-3" />
                <span className="font-semibold">Invalid Inertia Tensor</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 ml-4">
                {validation.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 3x3 Matrix Display */}
          <div className="space-y-1">
            {/* Header row */}
            <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground font-semibold">
              <div></div>
              <div className="text-center">X</div>
              <div className="text-center">Y</div>
              <div className="text-center">Z</div>
            </div>

            {/* Row X */}
            <div className="grid grid-cols-4 gap-1 items-center">
              <div className="text-[10px] text-muted-foreground font-semibold">X</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixx}
                      onValueChange={(val) => handleInertiaChange("ixx", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixx}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixy}
                      onValueChange={(val) => handleInertiaChange("ixy", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixy}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixz}
                      onValueChange={(val) => handleInertiaChange("ixz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixz}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Row Y */}
            <div className="grid grid-cols-4 gap-1 items-center">
              <div className="text-[10px] text-muted-foreground font-semibold">Y</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixy}
                      onValueChange={(val) => handleInertiaChange("ixy", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixy}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.iyy}
                      onValueChange={(val) => handleInertiaChange("iyy", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.iyy}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.iyz}
                      onValueChange={(val) => handleInertiaChange("iyz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.iyz}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Row Z */}
            <div className="grid grid-cols-4 gap-1 items-center">
              <div className="text-[10px] text-muted-foreground font-semibold">Z</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixz}
                      onValueChange={(val) => handleInertiaChange("ixz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixz}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.iyz}
                      onValueChange={(val) => handleInertiaChange("iyz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.iyz}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.izz}
                      onValueChange={(val) => handleInertiaChange("izz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.izz}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};
