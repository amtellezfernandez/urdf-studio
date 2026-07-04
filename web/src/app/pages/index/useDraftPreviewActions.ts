import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";

import type { CanonicalSynthesisPreviewSession } from "@/app/pages/index/indexPageRuntimeHelpers";
import {
  buildVirtualBakePreview,
  type UrdfBakePreviewSession,
} from "@/features/urdf/bake/virtualBake";
import { executeCanonicalSynthesisViaBackend } from "@/features/urdf/inertia/robotMasteringApi";
import { captureKinematicState } from "@/features/urdf/synthesis/kinematicSynthesizer";
import type { UrdfViewMode } from "@/shared/types/feature";

type UseDraftPreviewActionsParams = {
  bakePreviewSession: UrdfBakePreviewSession | null;
  robot: URDFRobot | null;
  setBakePreviewSession: Dispatch<SetStateAction<UrdfBakePreviewSession | null>>;
  setCanonicalSynthesisPreview: Dispatch<
    SetStateAction<CanonicalSynthesisPreviewSession | null>
  >;
  setShowUrdfEditor: Dispatch<SetStateAction<boolean>>;
  setUrdfViewMode: Dispatch<SetStateAction<UrdfViewMode>>;
  vizUrdfContent: string;
};

export const useDraftPreviewActions = ({
  bakePreviewSession,
  robot,
  setBakePreviewSession,
  setCanonicalSynthesisPreview,
  setShowUrdfEditor,
  setUrdfViewMode,
  vizUrdfContent,
}: UseDraftPreviewActionsParams) => {
  const handlePreviewBakeVisualTransforms = useCallback(() => {
    const preview = buildVirtualBakePreview(vizUrdfContent, {
      kinds: ["visual", "collision"],
    });
    if (preview.success === false) {
      toast.error(preview.error);
      return;
    }
    if (preview.entries.length === 0) {
      toast.info("No visual or collision origins need baking.");
      return;
    }

    setBakePreviewSession({
      sourceContent: vizUrdfContent,
      stagedContent: preview.content,
      preview,
    });
    toast.success(
      `Staged bake export for ${preview.entries.length} visual/collision entr${preview.entries.length === 1 ? "y" : "ies"}.`
    );
  }, [setBakePreviewSession, vizUrdfContent]);

  const handleClearBakePreviewSession = useCallback(() => {
    setBakePreviewSession(null);
  }, [setBakePreviewSession]);

  const handleCaptureCanonicalSynthesis = useCallback(async () => {
    const capturedState = captureKinematicState(robot, vizUrdfContent);
    if (!capturedState) {
      toast.error("Failed to capture the current robot state for canonical synthesis.");
      return;
    }
    try {
      const synthesisSourceContent = bakePreviewSession?.stagedContent ?? vizUrdfContent;
      const result = await executeCanonicalSynthesisViaBackend({
        sourceUrdf: vizUrdfContent,
        synthesisSourceUrdf: synthesisSourceContent,
        capturedState,
      });
      setCanonicalSynthesisPreview({
        sourceContent: vizUrdfContent,
        synthesisSourceContent,
        preview: result.preview,
        draftContent: result.draftContent,
      });
      setShowUrdfEditor(true);
      setUrdfViewMode("modified");
      toast.success(
        `Captured canonical synthesis draft for ${result.preview.jointCount} joint${result.preview.jointCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to generate a canonical URDF draft from the captured synthesis."
      );
    }
  }, [
    bakePreviewSession?.stagedContent,
    robot,
    setCanonicalSynthesisPreview,
    setShowUrdfEditor,
    setUrdfViewMode,
    vizUrdfContent,
  ]);

  const handleClearCanonicalSynthesisPreview = useCallback(() => {
    setCanonicalSynthesisPreview(null);
  }, [setCanonicalSynthesisPreview]);

  return {
    handleCaptureCanonicalSynthesis,
    handleClearBakePreviewSession,
    handleClearCanonicalSynthesisPreview,
    handlePreviewBakeVisualTransforms,
  };
};
