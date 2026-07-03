import { useCallback, useEffect } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { BlenderPanel, BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { useObjectStore } from "@/features/objects";
import { resolveTrackingReference } from "@/features/viewer/trackingTarget";
import { JOINT_LIST_SIDEBAR_PARAMS } from "@/features/layout/jointListSidebarParams";
import { LabeledNumberField } from "@/features/layout/sidebarNumberField";

type ObjectEditMode = "move" | "rotate" | "resize";
type ObjectTransformSpace = "world" | "local";
type ObjectVectorAxis = "x" | "y" | "z";

type ObjectVectorFieldsProps = {
  min?: number;
  onAxisValueChange: (axis: ObjectVectorAxis, value: number) => void;
  useCompactStackedInputs: boolean;
  vector: THREE.Vector3;
};

type ObjectOrbitFieldSpec = {
  label: string;
  max?: number;
  min?: number;
  onValueChange: (value: number) => void;
  step: number;
  value: number;
};

type ObjectOrbitFieldsProps = {
  fields: ObjectOrbitFieldSpec[];
  useCompactStackedInputs: boolean;
};

export interface ObjectEditorPanelProps {
  objectId: string;
  availableLinks: string[];
  sidebarWidth: number;
  robot?: URDFRobot | null;
  endEffectorLink?: string | null;
}

const OBJECT_FIELD_LABEL_CLASS = JOINT_LIST_SIDEBAR_PARAMS.classNames.cameraFieldLabel;
const OBJECT_EDITOR_CLASS_NAMES = JOINT_LIST_SIDEBAR_PARAMS.classNames;

const OBJECT_EDIT_MODES: ObjectEditMode[] = ["move", "rotate", "resize"];
const OBJECT_TRANSFORM_SPACES: ObjectTransformSpace[] = ["world", "local"];

const toObjectEditModeLabel = (mode: ObjectEditMode): string => {
  if (mode === "move") return "Move";
  if (mode === "rotate") return "Rotate";
  return "Resize";
};

const normalizeOrbitStartPoint = (
  value: "center" | "primary" | "secondary" | undefined
): "primary" | "secondary" => (value && value !== "center" ? value : "primary");

const normalizeDegrees360 = (value: number): number => ((value % 360) + 360) % 360;

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
};

function ObjectVectorFields({
  min,
  onAxisValueChange,
  useCompactStackedInputs,
  vector,
}: ObjectVectorFieldsProps) {
  const axes: ObjectVectorAxis[] = ["x", "y", "z"];
  if (useCompactStackedInputs) {
    return (
      <div className="space-y-1">
        {axes.map((axis) => (
          <LabeledNumberField
            key={axis}
            label={axis.toUpperCase()}
            value={vector[axis]}
            onValueChange={(value) => onAxisValueChange(axis, value)}
            step={0.01}
            min={min}
            className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactNumericInput}
            labelClassName="w-3 text-[9px] text-muted-foreground/80"
            wrapperClassName="flex items-center gap-1.5"
          />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-0.5">
      {axes.map((axis) => (
        <LabeledNumberField
          key={axis}
          label={axis.toUpperCase()}
          value={vector[axis]}
          onValueChange={(value) => onAxisValueChange(axis, value)}
          step={0.01}
          min={min}
          className={OBJECT_EDITOR_CLASS_NAMES.objectEditorInlineNumericInput}
          labelClassName="sr-only"
          wrapperClassName="space-y-0"
        />
      ))}
    </div>
  );
}

function ObjectOrbitFields({
  fields,
  useCompactStackedInputs,
}: ObjectOrbitFieldsProps) {
  if (useCompactStackedInputs) {
    return (
      <div className="space-y-1">
        {fields.map((field) => (
          <LabeledNumberField
            key={field.label}
            label={field.label}
            value={field.value}
            onValueChange={field.onValueChange}
            step={field.step}
            min={field.min}
            max={field.max}
            className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactNumericInput}
            labelClassName="w-16 text-[9px] text-muted-foreground/80"
            wrapperClassName="flex items-center gap-1.5"
          />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-1">
      {fields.map((field) => (
        <LabeledNumberField
          key={field.label}
          label={field.label}
          value={field.value}
          onValueChange={field.onValueChange}
          step={field.step}
          min={field.min}
          max={field.max}
          className={OBJECT_EDITOR_CLASS_NAMES.objectEditorInlineNumericInput}
          labelClassName={OBJECT_FIELD_LABEL_CLASS}
        />
      ))}
    </div>
  );
}

export const ObjectEditorPanel = ({
  objectId,
  availableLinks,
  sidebarWidth,
  robot,
  endEffectorLink,
}: ObjectEditorPanelProps) => {
  const objects = useObjectStore((state) => state.objects);
  const updateObjectPosition = useObjectStore((state) => state.updateObjectPosition);
  const updateObjectSize = useObjectStore((state) => state.updateObjectSize);
  const updateTrackedJoint = useObjectStore((state) => state.updateTrackedJoint);
  const updateIkTargetType = useObjectStore((state) => state.updateIkTargetType);
  const updateOrbitParams = useObjectStore((state) => state.updateOrbitParams);
  const updateOrbitTargetPoint = useObjectStore((state) => state.updateOrbitTargetPoint);
  const objectEditMode = useObjectStore((state) => state.editMode);
  const setObjectEditMode = useObjectStore((state) => state.setEditMode);
  const objectTransformSpace = useObjectStore((state) => state.transformSpace);
  const setObjectTransformSpace = useObjectStore((state) => state.setTransformSpace);
  const removeObject = useObjectStore((state) => state.removeObject);
  const undoObjectEdit = useObjectStore((state) => state.undo);
  const redoObjectEdit = useObjectStore((state) => state.redo);
  const canUndoObjectEdit = useObjectStore((state) => state.canUndo);
  const canRedoObjectEdit = useObjectStore((state) => state.canRedo);

  const obj = objects.find((object) => object.id === objectId);
  const toggleObjectTransformSpace = useCallback(() => {
    if (objectEditMode === "resize") {
      return;
    }
    setObjectTransformSpace(objectTransformSpace === "world" ? "local" : "world");
  }, [objectEditMode, objectTransformSpace, setObjectTransformSpace]);
  const selectObjectEditMode = useCallback(
    (mode: ObjectEditMode) => {
      setObjectEditMode(mode);
    },
    [setObjectEditMode]
  );
  const selectObjectTransformSpace = useCallback(
    (space: ObjectTransformSpace) => {
      setObjectTransformSpace(space);
    },
    [setObjectTransformSpace]
  );
  const deleteEditedObject = useCallback(() => {
    if (!obj) {
      return;
    }
    removeObject(obj.id);
  }, [obj, removeObject]);
  useEffect(() => {
    if (!obj) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          redoObjectEdit();
        } else {
          undoObjectEdit();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        event.stopPropagation();
        redoObjectEdit();
        return;
      }
      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        event.stopPropagation();
        selectObjectEditMode("move");
        return;
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        selectObjectEditMode("resize");
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        event.stopPropagation();
        selectObjectEditMode("rotate");
        return;
      }
      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        event.stopPropagation();
        toggleObjectTransformSpace();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        selectObjectEditMode("move");
        return;
      }

      const baseStep = event.metaKey || event.ctrlKey ? 0.002 : 0.01;
      const step = event.altKey ? 0.05 : baseStep;
      const nextPosition = obj.position.clone();

      switch (event.key) {
        case "ArrowLeft":
          nextPosition.x -= step;
          break;
        case "ArrowRight":
          nextPosition.x += step;
          break;
        case "ArrowUp":
          if (event.shiftKey) {
            nextPosition.z += step;
          } else {
            nextPosition.y += step;
          }
          break;
        case "ArrowDown":
          if (event.shiftKey) {
            nextPosition.z -= step;
          } else {
            nextPosition.y -= step;
          }
          break;
        default:
          return;
      }

      event.preventDefault();
      event.stopPropagation();
      updateObjectPosition(obj.id, nextPosition);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    obj,
    objectEditMode,
    objectTransformSpace,
    redoObjectEdit,
    selectObjectEditMode,
    toggleObjectTransformSpace,
    undoObjectEdit,
    updateObjectPosition,
  ]);
  const updateObjectVectorAxis = useCallback(
    (
      vector: THREE.Vector3,
      axis: ObjectVectorAxis,
      value: number,
      apply: (nextVector: THREE.Vector3) => void
    ) => {
      const nextVector = vector.clone();
      nextVector[axis] = value;
      apply(nextVector);
    },
    []
  );

  if (!obj) return null;

  const trackingReference = resolveTrackingReference({
    robot,
    trackedName: obj.trackedJointName,
    endEffectorLink,
  });
  const distance =
    trackingReference?.position !== null && trackingReference?.position !== undefined
      ? obj.position.distanceTo(trackingReference.position)
      : null;
  const useCompactStackedInputs = sidebarWidth < 272;
  const normalizedOrbitStartPoint = normalizeOrbitStartPoint(obj.orbitTargetPoint);
  const orbitFields: ObjectOrbitFieldSpec[] = [
    {
      label: "Radius (m)",
      value: obj.orbitRadius ?? 0.3,
      onValueChange: (value) => updateOrbitParams(obj.id, { radius: value }),
      step: 0.01,
      min: 0.01,
    },
    {
      label: "Tilt (deg)",
      value: obj.orbitInclination ?? 45,
      onValueChange: (value) => updateOrbitParams(obj.id, { inclination: value }),
      step: 5,
      min: -90,
      max: 90,
    },
    {
      label: "Start (deg)",
      value: obj.orbitPhase ?? 0,
      onValueChange: (value) =>
        updateOrbitParams(obj.id, { phase: normalizeDegrees360(value) }),
      step: 15,
      min: 0,
      max: 360,
    },
    {
      label: "Arc (deg)",
      value: obj.orbitSecondaryOffset ?? 180,
      onValueChange: (value) =>
        updateOrbitParams(obj.id, { secondaryOffset: normalizeDegrees360(value) }),
      step: 15,
      min: 0,
      max: 360,
    },
  ];

  return (
    <div className="p-0.5" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <BlenderPanel title={null} alwaysExpanded={true} className="text-[10px]">
        <div className="space-y-1">
          <BlenderPropertyRow label="Type" labelWidth="w-16">
            <span className="text-[10px] text-[#d4d4d4]">{obj.type.charAt(0).toUpperCase() + obj.type.slice(1)}</span>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Edit" labelWidth="w-16">
            <div className="flex items-center gap-1">
              {OBJECT_EDIT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => selectObjectEditMode(mode)}
                  className={`h-5 rounded px-1.5 text-[10px] transition-colors ${
                    objectEditMode === mode
                      ? "bg-[#3d3d3d] text-white"
                      : "text-[#d4d4d4] hover:text-white"
                  }`}
                  title={mode === "resize" ? "Resize" : undefined}
                >
                  {toObjectEditModeLabel(mode)}
                </button>
              ))}
            </div>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Space" labelWidth="w-16">
            <div className="flex items-center gap-1">
              {OBJECT_TRANSFORM_SPACES.map((space) => {
                const isDisabled = objectEditMode === "resize" && space === "world";
                return (
                  <button
                    key={space}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => selectObjectTransformSpace(space)}
                    className={`h-5 rounded px-1.5 text-[10px] transition-colors ${
                      (objectEditMode === "resize" ? "local" : objectTransformSpace) === space
                        ? "bg-[#3d3d3d] text-white"
                        : "text-[#d4d4d4] hover:text-white"
                    } ${isDisabled ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    {space === "world" ? "World" : "Local"}
                  </button>
                );
              })}
            </div>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Position" labelWidth="w-16" className="items-start">
            <ObjectVectorFields
              vector={obj.position}
              useCompactStackedInputs={useCompactStackedInputs}
              onAxisValueChange={(axis, value) =>
                updateObjectVectorAxis(obj.position, axis, value, (nextVector) =>
                  updateObjectPosition(obj.id, nextVector)
                )
              }
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Size" labelWidth="w-16" className="items-start">
            <ObjectVectorFields
              vector={obj.size}
              useCompactStackedInputs={useCompactStackedInputs}
              min={0.01}
              onAxisValueChange={(axis, value) =>
                updateObjectVectorAxis(obj.size, axis, value, (nextVector) =>
                  updateObjectSize(obj.id, nextVector)
                )
              }
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Reference" labelWidth="w-16">
            <Select
              value={
                obj.trackedJointName
                  ? obj.trackedJointName
                  : endEffectorLink
                    ? "__end_effector__"
                    : "none"
              }
              onValueChange={(value) => {
                if (value === "none") {
                  updateTrackedJoint(obj.id, null);
                } else if (value === "__end_effector__") {
                  updateTrackedJoint(obj.id, null);
                } else {
                  updateTrackedJoint(obj.id, value);
                }
              }}
            >
              <SelectTrigger className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactSelectTrigger}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactSelectContent}>
                {endEffectorLink && (
                  <SelectItem value="__end_effector__" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                    Use end-effector ({endEffectorLink})
                  </SelectItem>
                )}
                <SelectItem value="none" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                  None
                </SelectItem>
                {availableLinks.map((link) => (
                  <SelectItem key={link} value={link} className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                    {link}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Measure" labelWidth="w-16" className="items-start">
            <div className="space-y-0.5">
              <span className="block truncate text-[9px] text-[#d4d4d4]">{trackingReference?.label ?? "None"}</span>
              {trackingReference ? (
                <span className="block text-[9px] text-[#d4d4d4] font-mono">
                  {distance !== null ? `${distance.toFixed(4)} m` : "Unavailable"}
                </span>
              ) : null}
            </div>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Mode" labelWidth="w-16">
            <Select
              value={obj.ikTargetType ?? "punctual"}
              onValueChange={(value: "punctual" | "orbit") => updateIkTargetType(obj.id, value)}
            >
              <SelectTrigger className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactSelectTrigger}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactSelectContent}>
                <SelectItem value="punctual" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                  Point
                </SelectItem>
                <SelectItem value="orbit" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                  Orbit Path
                </SelectItem>
              </SelectContent>
            </Select>
          </BlenderPropertyRow>

          {obj.ikTargetType === "orbit" && (
            <>
              <BlenderPropertyRow label="Start" labelWidth="w-16">
                <Select
                  value={normalizedOrbitStartPoint}
                  onValueChange={(value: "primary" | "secondary") =>
                    updateOrbitTargetPoint(obj.id, value)
                  }
                >
                  <SelectTrigger className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactSelectTrigger}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactSelectContent}>
                    <SelectItem value="primary" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                      Primary
                    </SelectItem>
                    <SelectItem value="secondary" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                      Secondary
                    </SelectItem>
                  </SelectContent>
                </Select>
              </BlenderPropertyRow>

              <BlenderPropertyRow label="Orbit" labelWidth="w-16" className="items-start">
                <div className="space-y-1 w-full">
                  <div className="text-[8.5px] text-muted-foreground/80 leading-tight">
                    Click object: robot moves to orbit start, then follows arc.
                  </div>
                  <ObjectOrbitFields
                    fields={orbitFields}
                    useCompactStackedInputs={useCompactStackedInputs}
                  />
                </div>
              </BlenderPropertyRow>
            </>
          )}

          <div className="pt-0.5 border-t border-[#3d3d3d]">
            <div className="mb-1 flex items-center gap-2">
              <button
                type="button"
                onClick={undoObjectEdit}
                disabled={!canUndoObjectEdit}
                className="h-5 px-1 text-[10px] text-[#d4d4d4] transition-colors enabled:hover:text-white disabled:cursor-not-allowed disabled:text-[#6b6b6b]"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={redoObjectEdit}
                disabled={!canRedoObjectEdit}
                className="h-5 px-1 text-[10px] text-[#d4d4d4] transition-colors enabled:hover:text-white disabled:cursor-not-allowed disabled:text-[#6b6b6b]"
              >
                Redo
              </button>
            </div>
            <button
              type="button"
              onClick={deleteEditedObject}
              className="h-5 px-0.5 text-[10px] text-red-400 hover:text-red-300 transition-colors"
            >
              Delete object
            </button>
          </div>
        </div>
      </BlenderPanel>
    </div>
  );
};
