import { useEffect, type Dispatch, type SetStateAction } from "react";

import type {
  CanonicalSynthesisPreviewSession,
  InertialSynthesisSession,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import type { UrdfBakePreviewSession } from "@/features/urdf/bake/virtualBake";

type UseDraftSessionInvalidationParams = {
  bakePreviewSession: UrdfBakePreviewSession | null;
  canonicalSynthesisPreview: CanonicalSynthesisPreviewSession | null;
  inertialDraftBaseContent: string;
  inertialSynthesisSession: InertialSynthesisSession | null;
  setBakePreviewSession: Dispatch<SetStateAction<UrdfBakePreviewSession | null>>;
  setCanonicalSynthesisPreview: Dispatch<
    SetStateAction<CanonicalSynthesisPreviewSession | null>
  >;
  setInertialSynthesisSession: Dispatch<SetStateAction<InertialSynthesisSession | null>>;
  vizUrdfContent: string;
};

export const shouldClearBakePreviewSession = ({
  session,
  vizUrdfContent,
}: {
  session: UrdfBakePreviewSession | null;
  vizUrdfContent: string;
}): boolean => Boolean(session && vizUrdfContent !== session.sourceContent);

export const shouldClearCanonicalSynthesisPreview = ({
  activeSynthesisSourceContent,
  session,
  vizUrdfContent,
}: {
  activeSynthesisSourceContent: string;
  session: CanonicalSynthesisPreviewSession | null;
  vizUrdfContent: string;
}): boolean =>
  Boolean(
    session &&
      (vizUrdfContent !== session.sourceContent ||
        activeSynthesisSourceContent !== session.synthesisSourceContent)
  );

export const shouldClearInertialSynthesisSession = ({
  inertialDraftBaseContent,
  session,
  vizUrdfContent,
}: {
  inertialDraftBaseContent: string;
  session: InertialSynthesisSession | null;
  vizUrdfContent: string;
}): boolean =>
  Boolean(
    session &&
      (vizUrdfContent !== session.sourceContent ||
        inertialDraftBaseContent !== session.baseContent)
  );

export const useDraftSessionInvalidation = ({
  bakePreviewSession,
  canonicalSynthesisPreview,
  inertialDraftBaseContent,
  inertialSynthesisSession,
  setBakePreviewSession,
  setCanonicalSynthesisPreview,
  setInertialSynthesisSession,
  vizUrdfContent,
}: UseDraftSessionInvalidationParams) => {
  useEffect(() => {
    if (shouldClearBakePreviewSession({ session: bakePreviewSession, vizUrdfContent })) {
      setBakePreviewSession(null);
    }
  }, [bakePreviewSession, setBakePreviewSession, vizUrdfContent]);

  useEffect(() => {
    if (
      shouldClearCanonicalSynthesisPreview({
        activeSynthesisSourceContent: bakePreviewSession?.stagedContent ?? vizUrdfContent,
        session: canonicalSynthesisPreview,
        vizUrdfContent,
      })
    ) {
      setCanonicalSynthesisPreview(null);
    }
  }, [
    bakePreviewSession?.stagedContent,
    canonicalSynthesisPreview,
    setCanonicalSynthesisPreview,
    vizUrdfContent,
  ]);

  useEffect(() => {
    if (
      shouldClearInertialSynthesisSession({
        inertialDraftBaseContent,
        session: inertialSynthesisSession,
        vizUrdfContent,
      })
    ) {
      setInertialSynthesisSession(null);
    }
  }, [
    inertialDraftBaseContent,
    inertialSynthesisSession,
    setInertialSynthesisSession,
    vizUrdfContent,
  ]);
};
