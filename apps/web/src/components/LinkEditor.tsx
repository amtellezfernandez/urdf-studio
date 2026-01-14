import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { Search, X, Plus, Trash2 } from "lucide-react";
import {
  addCollisionToLink,
  addInertialToLink,
  parseLinksData,
  removeCollisionFromLink,
  removeInertialFromLink,
  removeVisualFromLink,
  type LinkData,
} from "@/features/urdf";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { VisualControl } from "@/components/link-editor/VisualControl";
import { CollisionControl } from "@/components/link-editor/CollisionControl";
import { InertialControl } from "@/components/link-editor/InertialControl";

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
  endEffectorLink?: string | null;
  onMarkAsEndEffector?: (linkName: string | null) => void;
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
  endEffectorLink,
  onMarkAsEndEffector,
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
    return parseLinksData(urdfContent).sort((a, b) => a.name.localeCompare(b.name));
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
        <div className="p-2 max-h-[50vh] overflow-y-auto minimal-scrollbar">
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
                endEffectorLink={endEffectorLink}
                onMarkAsEndEffector={onMarkAsEndEffector}
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
  endEffectorLink?: string | null;
  onMarkAsEndEffector?: (linkName: string | null) => void;
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
  endEffectorLink,
  onMarkAsEndEffector,
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
        {/* End Effector Button */}
        {onMarkAsEndEffector && (
          <div className="px-1 pt-0.5 pb-1 border-b border-border/15">
            <Button
              variant={endEffectorLink === linkData.name ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (endEffectorLink === linkData.name) {
                  onMarkAsEndEffector(null);
                  toast.success("End effector unmarked");
                } else {
                  onMarkAsEndEffector(linkData.name);
                  toast.success(`Marked "${linkData.name}" as end effector`);
                }
              }}
              className={cn(
                "h-6 px-2 text-[10px] w-full",
                endEffectorLink === linkData.name && "bg-primary text-primary-foreground"
              )}
            >
              {endEffectorLink === linkData.name ? "✓ End Effector" : "Mark as End Effector"}
            </Button>
          </div>
        )}

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
