import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface URDFHierarchyProps {
  urdfContent: string;
  isOpen: boolean;
  onClose: () => void;
  onUrdfChange?: (newContent: string) => void;
}

interface LinkNode {
  name: string;
  children: JointNode[];
  parentJoint?: string;
}

interface JointNode {
  name: string;
  type: string;
  parentLink: string;
  childLink: string;
  children?: string[];
}

interface HierarchyData {
  links: Map<string, LinkNode>;
  joints: Map<string, JointNode>;
  rootLinks: string[];
  duplicates: {
    links: string[];
    joints: string[];
  };
}

function parseURDFHierarchy(urdfContent: string): HierarchyData {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
  
  // Check for parsing errors
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    const errorText = parserError.textContent || "Unknown XML parsing error";
    console.error("URDF parsing error:", errorText);
    return {
      rootLinks: [],
      links: new Map(),
      joints: new Map(),
      duplicates: { links: [], joints: [] },
    };
  }
  
  // Validate robot element exists
  const robot = xmlDoc.querySelector("robot");
  if (!robot) {
    console.error("No <robot> element found in URDF");
    return {
      rootLinks: [],
      links: new Map(),
      joints: new Map(),
      duplicates: { links: [], joints: [] },
    };
  }

  const links = new Map<string, LinkNode>();
  const joints = new Map<string, JointNode>();
  const linkParents = new Map<string, string>(); // link name -> joint name
  const jointChildren = new Map<string, string>(); // joint name -> child link name

  // Parse all links
  const linkElements = xmlDoc.querySelectorAll("link");
  linkElements.forEach((link) => {
    const name = link.getAttribute("name");
    if (name) {
      links.set(name, {
        name,
        children: [],
        parentJoint: undefined,
      });
    }
  });

  // Parse all joints
  const jointElements = xmlDoc.querySelectorAll("joint");
  jointElements.forEach((joint) => {
    const name = joint.getAttribute("name");
    const type = joint.getAttribute("type") || "unknown";
    const parent = joint.querySelector("parent")?.getAttribute("link");
    const child = joint.querySelector("child")?.getAttribute("link");

    if (name && parent && child) {
      joints.set(name, {
        name,
        type,
        parentLink: parent,
        childLink: child,
        children: [],
      });
      linkParents.set(child, name);
      jointChildren.set(name, child);
    }
  });

  // Build hierarchy - assign parent joints to links
  links.forEach((link) => {
    const parentJointName = linkParents.get(link.name);
    if (parentJointName) {
      link.parentJoint = parentJointName;
    }
  });

  // Find root links (links with no parent joint)
  const rootLinks: string[] = [];
  links.forEach((link, name) => {
    if (!linkParents.has(name)) {
      rootLinks.push(name);
    }
  });

  // Find duplicates
  const linkNames = Array.from(links.keys());
  const jointNames = Array.from(joints.keys());
  const duplicateLinks = linkNames.filter(
    (name, index) => linkNames.indexOf(name) !== index
  );
  const duplicateJoints = jointNames.filter(
    (name, index) => jointNames.indexOf(name) !== index
  );

  return {
    links,
    joints,
    rootLinks,
    duplicates: {
      links: Array.from(new Set(duplicateLinks)),
      joints: Array.from(new Set(duplicateJoints)),
    },
  };
}

interface TreeNodeProps {
  linkName: string;
  links: Map<string, LinkNode>;
  joints: Map<string, JointNode>;
  level: number;
  expanded: Set<string>;
  onToggle: (name: string) => void;
}

interface TreeNodeProps {
  linkName: string;
  links: Map<string, LinkNode>;
  joints: Map<string, JointNode>;
  level: number;
  expanded: Set<string>;
  onToggle: (name: string) => void;
}

const TreeNode = ({ linkName, links, joints, level, expanded, onToggle }: TreeNodeProps) => {
  const link = links.get(linkName);
  if (!link) return null;

  // Find all joints that have this link as parent
  const childJoints: JointNode[] = [];
  joints.forEach((joint) => {
    if (joint.parentLink === linkName) {
      childJoints.push(joint);
    }
  });

  const hasChildren = childJoints.length > 0;
  const isExpanded = expanded.has(linkName);
  const parentJoint = link.parentJoint ? joints.get(link.parentJoint) : null;

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-1 py-0.5 px-1 hover:bg-muted/50 rounded group",
          level === 0 && "font-medium"
        )}
        style={{ paddingLeft: `${level * 16 + 4}px` }}
      >
        <div
          className="flex items-center gap-1 flex-1 cursor-pointer"
          onClick={() => onToggle(linkName)}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )
          ) : (
            <div className="w-3 h-3" />
          )}
          <span className="text-xs text-foreground">
            🔗 {linkName}
          </span>
          {parentJoint && (
            <span className="text-[10px] text-muted-foreground ml-2">
              ← {parentJoint.name} ({parentJoint.type})
            </span>
          )}
        </div>
      </div>
      {isExpanded && hasChildren && (
        <div>
          {childJoints.map((joint) => (
            <div key={joint.name}>
              {/* Joint node */}
              <div
                className="flex items-center gap-1 py-0.5 px-1 hover:bg-muted/30 rounded text-xs text-muted-foreground"
                style={{ paddingLeft: `${(level + 1) * 16 + 4}px` }}
              >
                <div className="w-3 h-3" />
                <span>⚙️ {joint.name}</span>
                <span className="text-[10px] ml-2">({joint.type})</span>
              </div>
              {/* Child link */}
              <TreeNode
                linkName={joint.childLink}
                links={links}
                joints={joints}
                level={level + 2}
                expanded={expanded}
                onToggle={onToggle}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const URDFHierarchy = ({
  urdfContent,
  isOpen,
  onClose,
  onUrdfChange,
}: URDFHierarchyProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const hierarchy = parseURDFHierarchy(urdfContent);

  const toggleNode = (name: string) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpanded(newExpanded);
  };

  const expandAll = () => {
    const allNames = new Set<string>();
    hierarchy.links.forEach((link) => {
      allNames.add(link.name);
    });
    setExpanded(allNames);
  };

  const collapseAll = () => {
    setExpanded(new Set());
  };


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>URDF Hierarchy</DialogTitle>
          <DialogDescription>
            Robot structure tree showing links and joints relationships
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Duplicates Warning */}
          {(hierarchy.duplicates.links.length > 0 ||
            hierarchy.duplicates.joints.length > 0) && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="flex-1 text-xs">
                <div className="font-medium text-yellow-700 mb-1">Duplicates Found:</div>
                {hierarchy.duplicates.links.length > 0 && (
                  <div className="text-yellow-600">
                    Duplicate links: {hierarchy.duplicates.links.join(", ")}
                  </div>
                )}
                {hierarchy.duplicates.joints.length > 0 && (
                  <div className="text-yellow-600">
                    Duplicate joints: {hierarchy.duplicates.joints.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={expandAll} className="text-xs">
              Expand All
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll} className="text-xs">
              Collapse All
            </Button>
            <div className="text-xs text-muted-foreground ml-auto">
              {hierarchy.links.size} links, {hierarchy.joints.size} joints
            </div>
          </div>

          {/* Tree View */}
          <ScrollArea className="flex-1 border rounded-md p-4 bg-muted/30">
            {hierarchy.rootLinks.length === 0 ? (
              <div className="text-xs text-muted-foreground">No root links found</div>
            ) : (
              <div>
                {hierarchy.rootLinks.map((rootLinkName) => (
                  <TreeNode
                    key={rootLinkName}
                    linkName={rootLinkName}
                    links={hierarchy.links}
                    joints={hierarchy.joints}
                    level={0}
                    expanded={expanded}
                    onToggle={toggleNode}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
