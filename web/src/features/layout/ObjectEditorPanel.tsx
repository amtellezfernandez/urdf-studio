import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { BlenderPanel, BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { useObjectStore } from "@/features/objects";
import { resolveTrackingReference } from "@/features/viewer/trackingTarget";
import { JOINT_LIST_SIDEBAR_PARAMS } from "@/features/layout/jointListSidebarParams";
import { LabeledNumberField } from "@/features/layout/sidebarNumberField";
import {
  applyObjectEditorKeyboardCommand,
  normalizeDegrees360,
  normalizeOrbitStartPoint,
  resolveObjectEditorKeyboardCommand,
  resolveObjectReferenceSelectValue,
  resolveTrackedJointValueFromSelection,
  toObjectEditModeLabel,
  type ObjectEditMode,
  type ObjectTransformSpace,
} from "@/features/layout/objectEditorPanelHelpers";

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

const SPLAT_SCALE_MIN = 0.001;
const SPLAT_SCALE_MAX = 1000;
// Multiplicative scrub: each pixel of horizontal drag multiplies the scale by
// e^(±sensitivity), so dragging feels uniform across magnitudes and can never
// push the scale to zero or negative.
const SPLAT_SCALE_DRAG_SENSITIVITY = 0.005;

type ObjectScaleScrubFieldProps = {
  value: number;
  onScrub: (value: number) => void;
  onCommit: (value: number) => void;
};

function ObjectScaleScrubField({ value, onScrub, onCommit }: ObjectScaleScrubFieldProps) {
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    lastValue: number;
  } | null>(null);

  const clampScale = (next: number) =>
    Math.min(SPLAT_SCALE_MAX, Math.max(SPLAT_SCALE_MIN, next));

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a nicety (keeps the drag alive outside the strip);
      // scrubbing still works without it.
    }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: value,
      lastValue: value,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const next = clampScale(
      dragState.startValue * Math.exp(deltaX * SPLAT_SCALE_DRAG_SENSITIVITY)
    );
    dragState.lastValue = next;
    onScrub(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    onCommit(dragState.lastValue);
  };

  return (
    <div className="flex items-center gap-1.5">
      <div
        role="slider"
        aria-label="Splat scale"
        aria-valuenow={value}
        aria-valuemin={SPLAT_SCALE_MIN}
        aria-valuemax={SPLAT_SCALE_MAX}
        title="Drag horizontally to scale"
        className="h-5 flex-1 cursor-ew-resize select-none rounded bg-[#2a2a2a] text-center text-[10px] leading-5 text-[#d4d4d4] transition-colors hover:bg-[#3d3d3d]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {`× ${Number(value.toPrecision(3))}`}
      </div>
      <LabeledNumberField
        label="Scale"
        value={value}
        onValueChange={(next) => onCommit(next)}
        step={0.01}
        min={SPLAT_SCALE_MIN}
        className={OBJECT_EDITOR_CLASS_NAMES.objectEditorCompactNumericInput}
        labelClassName="sr-only"
        wrapperClassName="w-16 space-y-0"
      />
    </div>
  );
}

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
  const updateObjectAssetScale = useObjectStore((state) => state.updateObjectAssetScale);
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

  const selectedObject = objects.find((object) => object.id === objectId);
  const isSplatObject = selectedObject?.type === "splat";
  const updateSelectedObjectPosition = useCallback(
    (position: THREE.Vector3) => {
      if (!selectedObject) {
        return;
      }
      updateObjectPosition(selectedObject.id, position);
    },
    [selectedObject, updateObjectPosition]
  );
  const updateSelectedObjectSize = useCallback(
    (size: THREE.Vector3) => {
      if (!selectedObject) {
        return;
      }
      updateObjectSize(selectedObject.id, size);
    },
    [selectedObject, updateObjectSize]
  );
  const scrubSelectedObjectAssetScale = useCallback(
    (scale: number) => {
      if (!selectedObject) {
        return;
      }
      updateObjectAssetScale(selectedObject.id, scale, { trackHistory: false });
    },
    [selectedObject, updateObjectAssetScale]
  );
  const commitSelectedObjectAssetScale = useCallback(
    (scale: number) => {
      if (!selectedObject) {
        return;
      }
      updateObjectAssetScale(selectedObject.id, scale);
    },
    [selectedObject, updateObjectAssetScale]
  );
  const updateSelectedObjectTrackedJoint = useCallback(
    (value: string) => {
      if (!selectedObject) {
        return;
      }
      updateTrackedJoint(
        selectedObject.id,
        resolveTrackedJointValueFromSelection(value)
      );
    },
    [selectedObject, updateTrackedJoint]
  );
  const updateSelectedObjectIkTargetType = useCallback(
    (nextTargetType: "punctual" | "orbit") => {
      if (!selectedObject) {
        return;
      }
      updateIkTargetType(selectedObject.id, nextTargetType);
    },
    [selectedObject, updateIkTargetType]
  );
  const updateSelectedObjectOrbitTargetPoint = useCallback(
    (value: "primary" | "secondary") => {
      if (!selectedObject) {
        return;
      }
      updateOrbitTargetPoint(selectedObject.id, value);
    },
    [selectedObject, updateOrbitTargetPoint]
  );
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
    if (!selectedObject) {
      return;
    }
    removeObject(selectedObject.id);
  }, [removeObject, selectedObject]);
  useEffect(() => {
    if (!selectedObject) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const command = resolveObjectEditorKeyboardCommand({
        key: event.key,
        modifiers: {
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
        position: selectedObject.position,
        target: event.target,
      });
      if (!command) return;

      event.preventDefault();
      event.stopPropagation();

      applyObjectEditorKeyboardCommand({
        command,
        onRedo: redoObjectEdit,
        onSelectMode: selectObjectEditMode,
        onToggleTransformSpace: toggleObjectTransformSpace,
        onUndo: undoObjectEdit,
        onUpdatePosition: updateSelectedObjectPosition,
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    objectEditMode,
    objectTransformSpace,
    redoObjectEdit,
    selectedObject,
    selectObjectEditMode,
    toggleObjectTransformSpace,
    undoObjectEdit,
    updateSelectedObjectPosition,
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

  if (!selectedObject) return null;

  const trackingReference = resolveTrackingReference({
    robot,
    trackedName: selectedObject.trackedJointName,
    endEffectorLink,
  });
  const distance =
    trackingReference?.position !== null && trackingReference?.position !== undefined
      ? selectedObject.position.distanceTo(trackingReference.position)
      : null;
  const useCompactStackedInputs = sidebarWidth < 272;
  const normalizedOrbitStartPoint = normalizeOrbitStartPoint(selectedObject.orbitTargetPoint);
  const orbitFields: ObjectOrbitFieldSpec[] = [
    {
      label: "Radius (m)",
      value: selectedObject.orbitRadius ?? 0.3,
      onValueChange: (value) => updateOrbitParams(selectedObject.id, { radius: value }),
      step: 0.01,
      min: 0.01,
    },
    {
      label: "Tilt (deg)",
      value: selectedObject.orbitInclination ?? 45,
      onValueChange: (value) => updateOrbitParams(selectedObject.id, { inclination: value }),
      step: 5,
      min: -90,
      max: 90,
    },
    {
      label: "Start (deg)",
      value: selectedObject.orbitPhase ?? 0,
      onValueChange: (value) =>
        updateOrbitParams(selectedObject.id, { phase: normalizeDegrees360(value) }),
      step: 15,
      min: 0,
      max: 360,
    },
    {
      label: "Arc (deg)",
      value: selectedObject.orbitSecondaryOffset ?? 180,
      onValueChange: (value) =>
        updateOrbitParams(selectedObject.id, { secondaryOffset: normalizeDegrees360(value) }),
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
            <span className="text-[10px] text-[#d4d4d4]">
              {selectedObject.type.charAt(0).toUpperCase() + selectedObject.type.slice(1)}
            </span>
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
                  title={mode === "resize" ? (isSplatObject ? "Scale" : "Resize") : undefined}
                >
                  {mode === "resize" && isSplatObject ? "Scale" : toObjectEditModeLabel(mode)}
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
              vector={selectedObject.position}
              useCompactStackedInputs={useCompactStackedInputs}
              onAxisValueChange={(axis, value) =>
                updateObjectVectorAxis(selectedObject.position, axis, value, (nextVector) =>
                  updateSelectedObjectPosition(nextVector)
                )
              }
            />
          </BlenderPropertyRow>

          {isSplatObject ? (
            <BlenderPropertyRow label="Scale" labelWidth="w-16">
              <ObjectScaleScrubField
                value={selectedObject.assetScale?.x ?? 1}
                onScrub={scrubSelectedObjectAssetScale}
                onCommit={commitSelectedObjectAssetScale}
              />
            </BlenderPropertyRow>
          ) : (
            <BlenderPropertyRow label="Size" labelWidth="w-16" className="items-start">
              <ObjectVectorFields
                vector={selectedObject.size}
                useCompactStackedInputs={useCompactStackedInputs}
                min={0.01}
                onAxisValueChange={(axis, value) =>
                  updateObjectVectorAxis(selectedObject.size, axis, value, (nextVector) =>
                    updateSelectedObjectSize(nextVector)
                  )
                }
              />
            </BlenderPropertyRow>
          )}

          <BlenderPropertyRow label="Reference" labelWidth="w-16">
            <Select
              value={
                resolveObjectReferenceSelectValue({
                  trackedJointName: selectedObject.trackedJointName,
                  endEffectorLink,
                })
              }
              onValueChange={updateSelectedObjectTrackedJoint}
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
              value={selectedObject.ikTargetType ?? "punctual"}
              onValueChange={updateSelectedObjectIkTargetType}
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

          {selectedObject.ikTargetType === "orbit" && (
            <>
              <BlenderPropertyRow label="Start" labelWidth="w-16">
                <Select
                  value={normalizedOrbitStartPoint}
                  onValueChange={updateSelectedObjectOrbitTargetPoint}
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
