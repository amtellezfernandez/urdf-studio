import { useState, useEffect, useRef } from "react";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { BlenderPanel } from "@/shared/ui/blender-panel";
import { Plus, Trash2 } from "lucide-react";
import {
  addCollisionToLink,
  addInertialToLink,
  removeCollisionFromLink,
  removeInertialFromLink,
  removeVisualFromLink,
} from "@/features/urdf/editor/updateLinkData";
import type { LinkData } from "@/features/urdf/parsing/parseLinkData";
import { cn } from "@/shared/lib/utils";
import { toast } from "sonner";
import { VisualControl } from "@/features/urdf/editor/link-editor/VisualControl";
import { CollisionControl } from "@/features/urdf/editor/link-editor/CollisionControl";
import { InertialControl } from "@/features/urdf/editor/link-editor/InertialControl";

// Collision visibility state type
export interface CollisionVisibility {
  [linkName: string]: {
    [collisionIndex: number]: boolean;
  };
}

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
