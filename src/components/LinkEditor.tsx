import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { Search, X, Plus, Trash2, Calculator, AlertTriangle, Eye, EyeOff, Info } from "lucide-react";
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
  combineMeshBounds,
  computePCA, 
  computeRotationToAxis,
  findMeshFile,
  computeCylinderDiagnostics,
  computeSphereDiagnostics,
  type CylinderDiagnostics,
  type SphereDiagnostics
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
  const [editingLinkName, setEditingLinkName] = useState<string | null>(null);
  const [editedName, setEditedName] = useState<string>("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Handle name editing
  const handleNameDoubleClick = (e: React.MouseEvent, linkName: string) => {
    if (!onLinkNameChange) return;
    e.stopPropagation();
    setEditingLinkName(linkName);
    setEditedName(linkName);
  };

  const handleNameSubmit = (linkName: string) => {
    const trimmedName = editedName.trim();
    if (trimmedName && trimmedName !== linkName && onLinkNameChange) {
      onLinkNameChange(linkName, trimmedName);
    }
    setEditingLinkName(null);
  };

  const handleNameCancel = () => {
    setEditingLinkName(null);
    setEditedName("");
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, linkName: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNameSubmit(linkName);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleNameCancel();
    }
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingLinkName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingLinkName]);

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

  // Render simple link list item (clickable, no expandable controls)
  const renderSimpleLinkItem = (link: LinkData) => {
    const isSelected = selectedLink === link.name;
    const isEditing = editingLinkName === link.name;

    return (
      <div
        key={link.name}
        className={cn(
          "px-1.5 py-1.5 hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/10",
          isSelected && "bg-primary/10 border-primary/30"
        )}
        onClick={() => !isEditing && onLinkSelect?.(link.name)}
        onMouseEnter={() => !isEditing && onLinkSelect?.(link.name)}
      >
        <div className="flex items-center justify-between gap-2">
          {isEditing ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={() => handleNameSubmit(link.name)}
              onKeyDown={(e) => handleNameKeyDown(e, link.name)}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "text-xs font-medium flex-1 min-w-0 text-left bg-background border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary",
                isSelected ? "text-primary" : "text-foreground"
              )}
            />
          ) : (
            <span
              className={cn(
                "text-xs font-medium truncate flex-1 cursor-text",
                isSelected ? "text-primary" : "text-foreground",
                onLinkNameChange && "hover:text-primary/80"
              )}
              title={onLinkNameChange ? "Double-click to rename" : undefined}
              onDoubleClick={(e) => handleNameDoubleClick(e, link.name)}
            >
              {link.name}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full h-full">
      {/* Header Controls - Minimalistic */}
      <div className="flex-shrink-0 space-y-1 px-1.5 py-1 border-b border-border/15">
        {/* Search Bar - Minimalistic */}
        <div className="relative">
          <Search className="absolute left-1 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 pl-7 pr-7 text-[10px] bg-input/50 border-border/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex items-center justify-center hover:bg-muted/50 rounded"
            >
              <X className="w-2.5 h-2.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Stats - Minimalistic */}
        {links.length > 0 && (
          <div className="text-[9px] text-muted-foreground/70 px-0.5">
            {filteredLinks.length} of {links.length}
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        )}
      </div>

      {/* Links List - Simple clickable list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1 px-1.5">
        {links.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[10px] text-muted-foreground/70">
            No links loaded
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[10px] text-muted-foreground/70">
            No links found
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        ) : (
          <div>
            {filteredLinks.map((link) => renderSimpleLinkItem(link))}
          </div>
        )}
      </div>

      {/* Link Editor Panel - Always visible */}
      <div className="flex-shrink-0 border-t border-border/20 bg-muted/5">
        <div className="p-2 max-h-[50vh] overflow-y-auto blender-scrollbar">
          {(() => {
            const selectedLinkData = selectedLink ? links.find(l => l.name === selectedLink) : null;
            return selectedLinkData ? (
              <LinkControl
                linkData={selectedLinkData}
                urdfContent={urdfContent}
                onMaterialChange={onMaterialChange}
                onLinkNameChange={onLinkNameChange}
                onUrdfChange={onUrdfChange}
                meshFiles={meshFiles}
                isHighlighted={true}
                onSelect={() => {}}
                collisionVisibility={collisionVisibility[selectedLink] || {}}
                onCollisionVisibilityChange={(index, visible) => {
                  const newVisibility = {
                    ...collisionVisibility,
                    [selectedLink]: {
                      ...(collisionVisibility[selectedLink] || {}),
                      [index]: visible,
                    },
                  };
                  onCollisionVisibilityChange?.(newVisibility);
                }}
                alwaysExpanded={true}
              />
            ) : (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/70">
                Click on a link to edit
              </div>
            );
          })()}
        </div>
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
  alwaysExpanded?: boolean;
}

export const LinkControl = ({
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
  alwaysExpanded = false,
}: LinkControlProps) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(linkData.name);
  const [activeSection, setActiveSection] = useState<"visual" | "collision" | "inertial">("visual");
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
    <div onMouseEnter={onSelect}>
      <BlenderPanel 
        title={alwaysExpanded ? null : (isEditingName ? (
            <Input
              ref={nameInputRef}
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={handleNameKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="h-5 text-xs px-1 bg-input/50 border-border/20 text-foreground"
              placeholder="Link name"
            />
          ) : (
            <span
              className={cn(
                "text-xs font-medium cursor-text hover:text-primary transition-colors truncate text-left block",
                isHighlighted ? "text-primary" : "text-foreground"
              )}
              onDoubleClick={handleNameDoubleClick}
              title={onLinkNameChange ? "Double-click to rename" : undefined}
            >
              {linkData.name}
            </span>
          ))}
        defaultOpen={alwaysExpanded}
        alwaysExpanded={alwaysExpanded}
        className={alwaysExpanded ? "mb-0" : ""}
      >
        {/* Section Selector */}
        <div className="flex items-center gap-0.5 px-1 py-0.5 mb-0.5 border-b border-border/15">
          <button
            onClick={() => setActiveSection("visual")}
            className={cn(
              "px-1 py-0.5 text-[9px] font-medium rounded-sm transition-colors",
              activeSection === "visual"
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
            )}
          >
            Visual
          </button>
          <button
            onClick={() => setActiveSection("collision")}
            className={cn(
              "px-1 py-0.5 text-[9px] font-medium rounded-sm transition-colors",
              activeSection === "collision"
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
            )}
          >
            Collision
          </button>
          <button
            onClick={() => setActiveSection("inertial")}
            className={cn(
              "px-1 py-0.5 text-[9px] font-medium rounded-sm transition-colors",
              activeSection === "inertial"
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
            )}
          >
            Inertial
          </button>
        </div>

        {/* Visual Section */}
        {activeSection === "visual" && (
          <div className="space-y-0.5">
            {linkData.visuals.length === 0 ? (
              <div className="text-[9px] text-muted-foreground/70 pb-1">
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
        )}

        {/* Collision Section */}
        {activeSection === "collision" && (
          <div className="space-y-0.5">
            {linkData.collisions.length === 0 ? (
              <div className="text-[9px] text-muted-foreground/70 pb-1">
                No collision elements
                {onUrdfChange && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[9px] ml-1.5"
                    onClick={handleAddCollision}
                  >
                    <Plus className="w-2.5 h-2.5 mr-0.5" />
                    Add
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
                  <div className="pt-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[9px] w-full"
                      onClick={handleAddCollision}
                    >
                      <Plus className="w-2.5 h-2.5 mr-0.5" />
                      Add Collision
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Inertial Section */}
        {activeSection === "inertial" && (
          <div className="space-y-0.5">
            {!linkData.inertial ? (
              <div className="text-[9px] text-muted-foreground/70 pb-1">
                No inertial element
                {onUrdfChange && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[9px] ml-1.5"
                    onClick={handleAddInertial}
                  >
                    <Plus className="w-2.5 h-2.5 mr-0.5" />
                    Add
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
                  <div className="pt-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[9px] text-destructive w-full"
                      onClick={handleRemoveInertial}
                    >
                      <Trash2 className="w-2.5 h-2.5 mr-0.5" />
                      Remove
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
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
    <BlenderPanel title={title} defaultOpen={true} className="mb-0.5">
      <div className="space-y-0.5">
        <BlenderPropertyRow label="Filename">
          <Input
            value={geometryParams.filename || ""}
            onChange={(e) => handleParamChange("filename", e.target.value)}
            className="h-6 text-[10px]"
            placeholder="meshes/model.stl"
          />
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Scale">
          <div className="flex items-center gap-0.5">
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
                className="w-14"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin XYZ">
          <div className="flex items-center gap-0.5">
            {origin.xyz.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("xyz", i, newVal)}
                step={0.01}
                compact
                className="w-14"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <div className="flex items-center gap-0.5">
            {origin.rpy.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("rpy", i, newVal)}
                step={0.01}
                compact
                className="w-14"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        {onMaterialChange && (
          <BlenderPropertyRow label="Color">
            <div className="flex items-center gap-1">
              <input
                type="color"
                value={currentColor}
                onChange={(e) => handleColorChange(e.target.value)}
                className="h-6 w-14 cursor-pointer rounded border border-border/20 bg-input"
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
                className="h-6 w-18 text-[10px] font-mono"
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
  const [selectedVisualMeshIndex, setSelectedVisualMeshIndex] = useState<number>(0);
  const [calculationInfo, setCalculationInfo] = useState<{
    meshIndex: number;
    meshFilename: string;
    method: string;
    formula?: string;
  } | null>(null);

  // Get visual mesh info for auto-filling - handle multiple meshes
  const visualMeshInfo = useMemo(() => {
    if (linkData.visuals.length === 0) return null;
    
    // Find all visual meshes (not just the first one)
    const visualMeshes = linkData.visuals.filter(v => v.geometry.type === "mesh");
    if (visualMeshes.length === 0) return null;
    
    // Return info about all meshes, not just the first
    return visualMeshes.map(visual => ({
      filename: visual.geometry.params.filename || "",
      scale: visual.geometry.params.scale || "1 1 1",
      origin: visual.origin,
    }));
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
    
    // Try to match current collision mesh filename to a visual mesh to set the correct index
    if (visualMeshInfo && visualMeshInfo.length > 1 && collision.geometry.type === "mesh") {
      const currentFilename = collision.geometry.params?.filename || "";
      const matchingIndex = visualMeshInfo.findIndex(
        mesh => mesh.filename === currentFilename || 
        mesh.filename.split("/").pop() === currentFilename.split("/").pop()
      );
      if (matchingIndex >= 0) {
        setSelectedVisualMeshIndex(matchingIndex);
      }
    }
  }, [collisionKey, visualMeshInfo]);

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
    // Clear calculation info when changing type
    setCalculationInfo(null);
    
    // Clear previous params and set new defaults based on type
    let newParams: Record<string, string> = {};
    let newOrigin = { xyz: [0, 0, 0] as [number, number, number], rpy: [0, 0, 0] as [number, number, number] };
    
    // If mesh type, copy from visual (use selected mesh index)
    if (newType === "mesh" && visualMeshInfo && visualMeshInfo.length > 0) {
      const meshIndex = Math.min(selectedVisualMeshIndex, visualMeshInfo.length - 1);
      const selectedMesh = visualMeshInfo[meshIndex];
      newParams = {
        filename: selectedMesh.filename,
        scale: selectedMesh.scale,
      };
      newOrigin = selectedMesh.origin;
    } else if (newType === "box" || newType === "sphere" || newType === "cylinder") {
      // Auto-calculate from mesh if visual mesh is available
      if (visualMeshInfo && visualMeshInfo.length > 0) {
        // Automatically calculate from mesh
        await handleAutoFill(newType);
        return; // handleAutoFill will update everything
      } else {
        // No mesh available, use defaults
        if (newType === "box") {
          newParams = { size: (geometryType === "box" && geometryParams.size) ? geometryParams.size : "1 1 1" };
        } else if (newType === "sphere") {
          newParams = { radius: (geometryType === "sphere" && geometryParams.radius) ? geometryParams.radius : "1" };
        } else if (newType === "cylinder") {
          newParams = { 
            radius: (geometryType === "cylinder" && geometryParams.radius) ? geometryParams.radius : "1",
            length: (geometryType === "cylinder" && geometryParams.length) ? geometryParams.length : "1"
          };
        }
      }
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
    if (!visualMeshInfo || visualMeshInfo.length === 0 || !onUrdfChange) {
      toast.error("No visual mesh found");
      return;
    }

    setIsComputing(true);
    try {
      // Use only the SELECTED visual mesh, not all of them
      const meshIndex = Math.min(selectedVisualMeshIndex, visualMeshInfo.length - 1);
      const selectedMeshInfo = visualMeshInfo[meshIndex];
      
      const meshFile = findMeshFile(selectedMeshInfo.filename, meshFiles);
      if (!meshFile) {
        toast.error(`Mesh file not found: ${selectedMeshInfo.filename}`);
        setIsComputing(false);
        return;
      }

      const bounds = await computeMeshBounds(meshFile, selectedMeshInfo.scale);
      if (!bounds) {
        toast.error("Failed to compute mesh bounds");
        setIsComputing(false);
        return;
      }
      
      let newGeometryType: "box" | "sphere" | "cylinder" | "mesh";
      let newGeometryParams: Record<string, string> = {};
      let newOrigin: { xyz: [number, number, number]; rpy: [number, number, number] } = { xyz: [0, 0, 0], rpy: [0, 0, 0] };
      let calculationMethod = "";
      let calculationFormula = "";

      if (type === "box") {
        // Axis-aligned bounding box in link coordinate frame
        // Transform all mesh vertices by visual mesh origin (xyz + rpy)
        // Then compute AABB in link space
        const visualMeshOrigin = selectedMeshInfo.origin;
        const [rx, ry, rz] = visualMeshOrigin.rpy;
        const [tx, ty, tz] = visualMeshOrigin.xyz;
        
        // Create rotation matrix from RPY (ZYX order: roll around Z, pitch around Y, yaw around X)
        // URDF uses fixed-axis rotations: R = R_z(roll) * R_y(pitch) * R_x(yaw)
        const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
        const cosRy = Math.cos(ry), sinRy = Math.sin(ry);
        const cosRz = Math.cos(rz), sinRz = Math.sin(rz);
        
        // Rotation matrix (ZYX order)
        const R = [
          [cosRz * cosRy, cosRz * sinRy * sinRx - sinRz * cosRx, cosRz * sinRy * cosRx + sinRz * sinRx],
          [sinRz * cosRy, sinRz * sinRy * sinRx + cosRz * cosRx, sinRz * sinRy * cosRx - cosRz * sinRx],
          [-sinRy, cosRy * sinRx, cosRy * cosRx]
        ];
        
        // Transform all vertices to link space and compute AABB
        const vertexCount = bounds.vertices.length / 3;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        
        for (let i = 0; i < vertexCount; i++) {
          const x = bounds.vertices[i * 3];
          const y = bounds.vertices[i * 3 + 1];
          const z = bounds.vertices[i * 3 + 2];
          
          // Apply rotation
          const xRot = R[0][0] * x + R[0][1] * y + R[0][2] * z;
          const yRot = R[1][0] * x + R[1][1] * y + R[1][2] * z;
          const zRot = R[2][0] * x + R[2][1] * y + R[2][2] * z;
          
          // Apply translation
          const xLink = xRot + tx;
          const yLink = yRot + ty;
          const zLink = zRot + tz;
          
          minX = Math.min(minX, xLink);
          minY = Math.min(minY, yLink);
          minZ = Math.min(minZ, zLink);
          maxX = Math.max(maxX, xLink);
          maxY = Math.max(maxY, yLink);
          maxZ = Math.max(maxZ, zLink);
        }
        
        const boxSize = [maxX - minX, maxY - minY, maxZ - minZ];
        const boxCenter = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
        
        newGeometryType = "box";
        newGeometryParams = {
          size: `${boxSize[0]} ${boxSize[1]} ${boxSize[2]}`,
        };
        newOrigin = {
          xyz: boxCenter,
          rpy: [0, 0, 0], // Box is axis-aligned in link frame
        };
        calculationMethod = "Axis-Aligned Bounding Box (AABB) in Link Frame";
        calculationFormula = `1. Transform mesh vertices by visual origin (xyz + rpy)\n2. Compute AABB in link coordinate frame\n3. size = [max_x - min_x, max_y - min_y, max_z - min_z]\n4. center = [(min_x + max_x)/2, (min_y + max_y)/2, (min_z + max_z)/2]`;
      } else if (type === "sphere") {
        // Robust sphere fitting with automatic suitability check
        // Step 1: Transform vertices to link space
        const visualMeshOrigin = selectedMeshInfo.origin;
        const [rx, ry, rz] = visualMeshOrigin.rpy;
        const [tx, ty, tz] = visualMeshOrigin.xyz;
        
        // Create rotation matrix from RPY (ZYX order)
        const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
        const cosRy = Math.cos(ry), sinRy = Math.sin(ry);
        const cosRz = Math.cos(rz), sinRz = Math.sin(rz);
        
        const R = [
          [cosRz * cosRy, cosRz * sinRy * sinRx - sinRz * cosRx, cosRz * sinRy * cosRx + sinRz * sinRx],
          [sinRz * cosRy, sinRz * sinRy * sinRx + cosRz * cosRx, sinRz * sinRy * cosRx - cosRz * sinRx],
          [-sinRy, cosRy * sinRx, cosRy * cosRx]
        ];
        
        // Transform vertices to link space
        const vertexCount = bounds.vertices.length / 3;
        const transformedVertices: number[] = [];
        
        for (let i = 0; i < vertexCount; i++) {
          const x = bounds.vertices[i * 3];
          const y = bounds.vertices[i * 3 + 1];
          const z = bounds.vertices[i * 3 + 2];
          
          // Apply rotation
          const xRot = R[0][0] * x + R[0][1] * y + R[0][2] * z;
          const yRot = R[1][0] * x + R[1][1] * y + R[1][2] * z;
          const zRot = R[2][0] * x + R[2][1] * y + R[2][2] * z;
          
          // Apply translation
          transformedVertices.push(xRot + tx, yRot + ty, zRot + tz);
        }
        
        const transformedVerticesArray = new Float32Array(transformedVertices);
        
        // Step 2: Compute PCA and diagnostics
        const pca = computePCA(transformedVerticesArray);
        if (!pca) {
          toast.error("Failed to compute PCA");
          setIsComputing(false);
          return;
        }
        
        const diagnostics = computeSphereDiagnostics(transformedVerticesArray, pca);
        
        // Step 3: Decide on sphere fitting method based on diagnostics
        let centerX: number, centerY: number, centerZ: number;
        let radius: number;
        let methodName: string;
        let formula: string;
        let warning: string | null = null;
        
        if (diagnostics.isIsotropic) {
          // Good fit for sphere - use robust percentile radius
          centerX = pca.centroid[0];
          centerY = pca.centroid[1];
          centerZ = pca.centroid[2];
          radius = diagnostics.radialP95; // Use 95th percentile (robust to small protrusions)
          
          methodName = "Robust Sphere (Isotropic)";
          formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(2)} < 2, flatness=${diagnostics.flatness.toFixed(2)} < 2\n3. Shape is isotropic → sphere is appropriate\n4. Use 95th percentile radius (robust to outliers)`;
        } else if (diagnostics.isElongated) {
          // Elongated shape - sphere not ideal, but compute anyway with warning
          centerX = pca.centroid[0];
          centerY = pca.centroid[1];
          centerZ = pca.centroid[2];
          radius = diagnostics.radialP95; // Use 95th percentile
          
          methodName = "Robust Sphere (Elongated - Not Ideal)";
          warning = `Shape is elongated (elongation=${diagnostics.elongation.toFixed(2)}). Consider using cylinder/capsule instead.`;
          formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(2)} > 3 (elongated)\n3. Sphere may not be optimal - consider cylinder\n4. Use 95th percentile radius`;
        } else if (diagnostics.isFlat) {
          // Flat/slab-like - sphere not ideal
          centerX = pca.centroid[0];
          centerY = pca.centroid[1];
          centerZ = pca.centroid[2];
          radius = diagnostics.radialP95;
          
          methodName = "Robust Sphere (Flat - Not Ideal)";
          warning = `Shape is flat (flatness=${diagnostics.flatness.toFixed(2)}). Consider using box instead.`;
          formula = `1. Transform vertices by visual origin\n2. flatness=${diagnostics.flatness.toFixed(2)} > 3 (slab-like)\n3. Sphere may not be optimal - consider box\n4. Use 95th percentile radius`;
        } else {
          // Moderate anisotropy - use robust radius
          centerX = pca.centroid[0];
          centerY = pca.centroid[1];
          centerZ = pca.centroid[2];
          radius = diagnostics.radialP95;
          
          methodName = "Robust Sphere (Moderate Anisotropy)";
          formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(2)}, flatness=${diagnostics.flatness.toFixed(2)}\n3. Moderate anisotropy - sphere acceptable\n4. Use 95th percentile radius (robust)`;
        }
        
        // If outlier ratio is high, show additional info
        if (diagnostics.outlierRatio > 1.3) {
          if (warning) {
            warning += ` High outlier ratio (${diagnostics.outlierRatio.toFixed(2)}) - may have protrusions.`;
          } else {
            warning = `High outlier ratio (${diagnostics.outlierRatio.toFixed(2)}) - using robust radius to ignore protrusions.`;
          }
        }
        
        if (warning) {
          toast.warning(warning, { duration: 5000 });
        }
        
        newGeometryType = "sphere";
        newGeometryParams = {
          radius: String(radius),
        };
        newOrigin = {
          xyz: [centerX, centerY, centerZ],
          rpy: [0, 0, 0],
        };
        calculationMethod = methodName;
        calculationFormula = formula;
      } else if (type === "cylinder" || type === "capsule") {
        // Robust cylinder fitting with automatic method selection
        // Step 1: Transform vertices to link space
        const visualMeshOrigin = selectedMeshInfo.origin;
        const [rx, ry, rz] = visualMeshOrigin.rpy;
        const [tx, ty, tz] = visualMeshOrigin.xyz;
        
        // Create rotation matrix from RPY (ZYX order)
        const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
        const cosRy = Math.cos(ry), sinRy = Math.sin(ry);
        const cosRz = Math.cos(rz), sinRz = Math.sin(rz);
        
        const R = [
          [cosRz * cosRy, cosRz * sinRy * sinRx - sinRz * cosRx, cosRz * sinRy * cosRx + sinRz * sinRx],
          [sinRz * cosRy, sinRz * sinRy * sinRx + cosRz * cosRx, sinRz * sinRy * cosRx - cosRz * sinRx],
          [-sinRy, cosRy * sinRx, cosRy * cosRx]
        ];
        
        // Transform vertices to link space and compute AABB
        const vertexCount = bounds.vertices.length / 3;
        const transformedVertices: number[] = [];
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        
        for (let i = 0; i < vertexCount; i++) {
          const x = bounds.vertices[i * 3];
          const y = bounds.vertices[i * 3 + 1];
          const z = bounds.vertices[i * 3 + 2];
          
          // Apply rotation
          const xRot = R[0][0] * x + R[0][1] * y + R[0][2] * z;
          const yRot = R[1][0] * x + R[1][1] * y + R[1][2] * z;
          const zRot = R[2][0] * x + R[2][1] * y + R[2][2] * z;
          
          // Apply translation
          const xLink = xRot + tx;
          const yLink = yRot + ty;
          const zLink = zRot + tz;
          
          transformedVertices.push(xLink, yLink, zLink);
          
          minX = Math.min(minX, xLink);
          minY = Math.min(minY, yLink);
          minZ = Math.min(minZ, zLink);
          maxX = Math.max(maxX, xLink);
          maxY = Math.max(maxY, yLink);
          maxZ = Math.max(maxZ, zLink);
        }
        
        const transformedVerticesArray = new Float32Array(transformedVertices);
        
        // Step 2: Compute PCA and diagnostics
        const pca = computePCA(transformedVerticesArray);
        if (!pca) {
          toast.error("Failed to compute PCA");
          setIsComputing(false);
          return;
        }
        
        const diagnostics = computeCylinderDiagnostics(transformedVerticesArray, pca);
        
        // Step 3: Automatic method selection based on diagnostics
        let fitResult: { radius: number; height: number; center: [number, number, number]; axis: [number, number, number] };
        let methodName: string;
        let formula: string;
        
        if (diagnostics.elongation > 5) {
          // Long shape - check if clean cylinder
          if (diagnostics.roundness < 1.2 && diagnostics.outlierRatio < 1.2) {
            // Case 1: Clean cylinder - use percentile-based PCA
            const vertexCount = transformedVerticesArray.length / 3;
            const axis = pca.axis;
            const centroid = pca.centroid;
            
            // Project vertices onto axis
            const tValues: number[] = [];
            for (let i = 0; i < vertexCount; i++) {
              const x = transformedVerticesArray[i * 3] - centroid[0];
              const y = transformedVerticesArray[i * 3 + 1] - centroid[1];
              const z = transformedVerticesArray[i * 3 + 2] - centroid[2];
              const t = x * axis[0] + y * axis[1] + z * axis[2];
              tValues.push(t);
            }
            
            tValues.sort((a, b) => a - b);
            const height = tValues[tValues.length - 1] - tValues[0];
            const radius = diagnostics.radialP95;
            
            const centerX = centroid[0] + (tValues[0] + tValues[tValues.length - 1]) / 2 * axis[0];
            const centerY = centroid[1] + (tValues[0] + tValues[tValues.length - 1]) / 2 * axis[1];
            const centerZ = centroid[2] + (tValues[0] + tValues[tValues.length - 1]) / 2 * axis[2];
            
            fitResult = { radius, height, center: [centerX, centerY, centerZ], axis };
            methodName = "Percentile-based PCA Cylinder";
            formula = `1. Transform vertices by visual origin\n2. Compute PCA diagnostics\n3. elongation=${diagnostics.elongation.toFixed(2)}, roundness=${diagnostics.roundness.toFixed(2)}\n4. Use 95th percentile radius (robust)\n5. height = max(t) - min(t) along PCA axis`;
          } else if (diagnostics.roundness > 1.5) {
            // Case 3: Non-circular cross-section - use constrained axis
            const sizeX = maxX - minX;
            const sizeY = maxY - minY;
            const sizeZ = maxZ - minZ;
            
            let axis: [number, number, number];
            let height: number;
            let centerX: number, centerY: number, centerZ: number;
            
            if (sizeX >= sizeY && sizeX >= sizeZ) {
              axis = [1, 0, 0];
              height = sizeX;
            } else if (sizeY >= sizeX && sizeY >= sizeZ) {
              axis = [0, 1, 0];
              height = sizeY;
            } else {
              axis = [0, 0, 1];
              height = sizeZ;
            }
            
            centerX = (minX + maxX) / 2;
            centerY = (minY + maxY) / 2;
            centerZ = (minZ + maxZ) / 2;
            
            // Compute radius using 95th percentile
            const radialDistances: number[] = [];
            for (let i = 0; i < vertexCount; i++) {
              const x = transformedVertices[i * 3] - centerX;
              const y = transformedVertices[i * 3 + 1] - centerY;
              const z = transformedVertices[i * 3 + 2] - centerZ;
              
              const t = x * axis[0] + y * axis[1] + z * axis[2];
              const projX = t * axis[0];
              const projY = t * axis[1];
              const projZ = t * axis[2];
              
              const orthoX = x - projX;
              const orthoY = y - projY;
              const orthoZ = z - projZ;
              const radius = Math.sqrt(orthoX * orthoX + orthoY * orthoY + orthoZ * orthoZ);
              radialDistances.push(radius);
            }
            
            radialDistances.sort((a, b) => a - b);
            const radius = radialDistances[Math.floor(vertexCount * 0.95)];
            
            fitResult = { radius, height, center: [centerX, centerY, centerZ], axis };
            methodName = "Constrained Axis Fit (Non-circular)";
            const axisName = axis[0] === 1 ? "X" : axis[1] === 1 ? "Y" : "Z";
            formula = `1. Transform vertices by visual origin\n2. roundness=${diagnostics.roundness.toFixed(2)} > 1.5 (non-circular)\n3. Use longest AABB dimension: ${axisName}-axis\n4. radius = 95th percentile distance to axis`;
          } else {
            // Case 2: Long with outliers - use percentile PCA (simplified, RANSAC would be better but complex)
            const vertexCount = transformedVerticesArray.length / 3;
            const axis = pca.axis;
            const centroid = pca.centroid;
            
            const tValues: number[] = [];
            for (let i = 0; i < vertexCount; i++) {
              const x = transformedVerticesArray[i * 3] - centroid[0];
              const y = transformedVerticesArray[i * 3 + 1] - centroid[1];
              const z = transformedVerticesArray[i * 3 + 2] - centroid[2];
              const t = x * axis[0] + y * axis[1] + z * axis[2];
              tValues.push(t);
            }
            
            tValues.sort((a, b) => a - b);
            const height = tValues[tValues.length - 1] - tValues[0];
            const radius = diagnostics.radialP95; // Use 95th percentile to ignore outliers
            
            const centerX = centroid[0] + (tValues[0] + tValues[tValues.length - 1]) / 2 * axis[0];
            const centerY = centroid[1] + (tValues[0] + tValues[tValues.length - 1]) / 2 * axis[1];
            const centerZ = centroid[2] + (tValues[0] + tValues[tValues.length - 1]) / 2 * axis[2];
            
            fitResult = { radius, height, center: [centerX, centerY, centerZ], axis };
            methodName = "Percentile PCA (with Outliers)";
            formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(2)} > 5, outlier_ratio=${diagnostics.outlierRatio.toFixed(2)}\n3. Use 95th percentile radius (robust to outliers)\n4. PCA axis with percentile filtering`;
          }
        } else {
          // Case 4: Not strongly cylindrical - use constrained axis (longest dimension)
          const sizeX = maxX - minX;
          const sizeY = maxY - minY;
          const sizeZ = maxZ - minZ;
          
          let axis: [number, number, number];
          let height: number;
          let centerX: number, centerY: number, centerZ: number;
          
          if (sizeX >= sizeY && sizeX >= sizeZ) {
            axis = [1, 0, 0];
            height = sizeX;
          } else if (sizeY >= sizeX && sizeY >= sizeZ) {
            axis = [0, 1, 0];
            height = sizeY;
          } else {
            axis = [0, 0, 1];
            height = sizeZ;
          }
          
          centerX = (minX + maxX) / 2;
          centerY = (minY + maxY) / 2;
          centerZ = (minZ + maxZ) / 2;
          
          // Compute radius using 95th percentile
          const radialDistances: number[] = [];
          for (let i = 0; i < vertexCount; i++) {
            const x = transformedVertices[i * 3] - centerX;
            const y = transformedVertices[i * 3 + 1] - centerY;
            const z = transformedVertices[i * 3 + 2] - centerZ;
            
            const t = x * axis[0] + y * axis[1] + z * axis[2];
            const projX = t * axis[0];
            const projY = t * axis[1];
            const projZ = t * axis[2];
            
            const orthoX = x - projX;
            const orthoY = y - projY;
            const orthoZ = z - projZ;
            const radius = Math.sqrt(orthoX * orthoX + orthoY * orthoY + orthoZ * orthoZ);
            radialDistances.push(radius);
          }
          
          radialDistances.sort((a, b) => a - b);
          const radius = radialDistances[Math.floor(vertexCount * 0.95)];
          
          fitResult = { radius, height, center: [centerX, centerY, centerZ], axis };
          methodName = "Constrained Axis (Low Elongation)";
          const axisName = axis[0] === 1 ? "X" : axis[1] === 1 ? "Y" : "Z";
          formula = `1. Transform vertices by visual origin\n2. elongation=${diagnostics.elongation.toFixed(2)} < 5 (not strongly cylindrical)\n3. Use longest AABB dimension: ${axisName}-axis\n4. radius = 95th percentile distance to axis`;
        }
        
        // Compute rotation to align URDF Z-axis with chosen axis
        const rotation = computeRotationToAxis(fitResult.axis);

        newGeometryType = "cylinder";
        newGeometryParams = {
          radius: String(fitResult.radius),
          length: String(fitResult.height),
        };
        calculationMethod = methodName;
        calculationFormula = formula;
        newOrigin = {
          xyz: fitResult.center,
          rpy: rotation.rpy,
        };

        if (type === "capsule") {
          toast.info("Capsule approximated as cylinder in URDF");
        }
      }

      setGeometryType(newGeometryType);
      setGeometryParams(newGeometryParams);
      setOrigin(newOrigin);
      
      // Store calculation info for display
      const meshFilename = selectedMeshInfo.filename.split("/").pop() || selectedMeshInfo.filename;
      setCalculationInfo({
        meshIndex: meshIndex,
        meshFilename: meshFilename,
        method: calculationMethod,
        formula: calculationFormula,
      });
      
      const newContent = updateCollisionInLink(
        urdfContent!,
        linkName,
        index,
        newGeometryType,
        newGeometryParams,
        newOrigin
      );
      onUrdfChange(newContent);
      
      setIsComputing(false);
      const meshLabel = visualMeshInfo.length > 1 ? ` (from Visual Mesh ${meshIndex + 1})` : "";
      toast.success(`Computed ${type} collision geometry${meshLabel}`);
    } catch (error) {
      console.error("Error auto-filling collision:", error);
      toast.error("Failed to auto-fill collision");
    } finally {
      setIsComputing(false);
    }
  };

  const handleParamChange = (key: string, value: string) => {
    setGeometryParams({ ...geometryParams, [key]: value });
    // Clear calculation info when manually changing parameters
    setCalculationInfo(null);
    setTimeout(updateURDF, 0);
  };

  const handleOriginChange = (field: "xyz" | "rpy", index: number, value: number) => {
    const newOrigin = { ...origin };
    newOrigin[field][index] = value;
    setOrigin(newOrigin);
    // Clear calculation info when manually changing origin
    setCalculationInfo(null);
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
              className="h-4 w-4 flex items-center justify-center hover:bg-muted/50 rounded transition-colors flex-shrink-0"
              title={isVisible ? "Hide collision in visualizer" : "Show collision in visualizer"}
            >
              {isVisible ? (
                <Eye className="w-3 h-3 text-primary" />
              ) : (
                <EyeOff className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      } 
      defaultOpen={false} 
      className="mb-0.5"
    >
      <div className="space-y-0.5">
        <BlenderPropertyRow label="Geometry Type">
          <Select value={geometryType} onValueChange={handleGeometryTypeChange}>
            <SelectTrigger className="h-6 text-[10px]">
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

        {/* Calculation Info - Blender style transparency */}
        {calculationInfo && (
          <div className="px-1 py-0.5 bg-muted/10 rounded-sm border border-border/15">
            <div className="flex items-start gap-1 mb-0.5">
              <Info className="w-2.5 h-2.5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-semibold text-foreground mb-0.5">
                  Calculated from Mesh
                </div>
                <div className="text-[8px] text-muted-foreground">
                  {visualMeshInfo && visualMeshInfo.length > 1 
                    ? `Visual Mesh ${calculationInfo.meshIndex + 1}: ${calculationInfo.meshFilename}`
                    : calculationInfo.meshFilename}
                </div>
              </div>
            </div>
            <div className="px-2.5 space-y-0.5">
              <div className="text-[8px] font-medium text-foreground/90">
                Method: {calculationInfo.method}
              </div>
              {calculationInfo.formula && (
                <div className="text-[7px] text-muted-foreground font-mono bg-background/50 px-1 py-0.5 rounded border border-border/20 whitespace-pre-wrap">
                  {calculationInfo.formula}
                </div>
              )}
            </div>
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
            {/* Visual Mesh Selector - only show if multiple visual meshes exist */}
            {visualMeshInfo && visualMeshInfo.length > 1 && (
              <BlenderPropertyRow label="Visual Mesh">
                <Select
                  value={String(selectedVisualMeshIndex)}
                  onValueChange={(value) => {
                    const newIndex = parseInt(value, 10);
                    setSelectedVisualMeshIndex(newIndex);
                    // Update collision mesh to use the selected visual mesh
                    const selectedMesh = visualMeshInfo[newIndex];
                    handleParamChange("filename", selectedMesh.filename);
                    handleParamChange("scale", selectedMesh.scale);
                    setOrigin(selectedMesh.origin);
                    updateURDF();
                  }}
                >
                  <SelectTrigger className="h-6 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visualMeshInfo.map((mesh, idx) => (
                      <SelectItem key={idx} value={String(idx)} className="text-[10px]">
                        Visual Mesh {idx + 1} {mesh.filename ? `(${mesh.filename.split("/").pop()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BlenderPropertyRow>
            )}
            <BlenderPropertyRow label="Filename">
              <Input
                value={geometryParams.filename || ""}
                onChange={(e) => handleParamChange("filename", e.target.value)}
                className="h-6 text-[10px]"
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
              className="h-5 px-1.5 text-[9px] text-destructive w-full"
              onClick={onRemove}
            >
              <Trash2 className="w-2.5 h-2.5 mr-0.5" />
              Remove
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
