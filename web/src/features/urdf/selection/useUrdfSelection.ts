import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJointStore } from "@/shared/store/useJointStore";
import type { SetJointValueOptions } from "@/shared/store/useJointStore";
import {
  findAutoEndEffectorLinksFromAnalysis,
  findDeepestLeafLink,
} from "@/features/layout/page/utils";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";

type SelectionContext = {
  vizUrdfContent?: string | null;
  availableLinks?: string[];
  urdfAnalysis?: UrdfAnalysis | null;
};

export const useUrdfSelection = () => {
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [hoveredJoint, setHoveredJoint] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [endEffectorLink, setEndEffectorLinkState] = useState<string | null>(null);
  const [isEndEffectorSelectionManual, setIsEndEffectorSelectionManual] = useState(false);
  const [endEffectorCandidates, setEndEffectorCandidates] = useState<string[]>([]);
  const [deletedJoints, setDeletedJoints] = useState<Set<string>>(new Set());
  const previousUrdfContentRef = useRef<string | null>(null);
  const [context, setContextState] = useState<SelectionContext>({
    vizUrdfContent: null,
    availableLinks: [],
    urdfAnalysis: null,
  });

  const jointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);

  const clearSelection = useCallback(() => {
    setSelectedJoint(null);
    setSelectedLink(null);
    setHoveredJoint(null);
    setHoveredLink(null);
  }, []);

  const setContext = useCallback((next: SelectionContext) => {
    setContextState((prev) => {
      if (
        prev.vizUrdfContent === next.vizUrdfContent &&
        prev.availableLinks === next.availableLinks &&
        prev.urdfAnalysis === next.urdfAnalysis
      ) {
        return prev;
      }
      return {
        vizUrdfContent: next.vizUrdfContent ?? null,
        availableLinks: next.availableLinks ?? [],
        urdfAnalysis: next.urdfAnalysis ?? null,
      };
    });
  }, []);

  const setEndEffectorLink = useCallback((linkName: string | null) => {
    setEndEffectorLinkState(linkName);
    setIsEndEffectorSelectionManual(true);
  }, []);

  useEffect(() => {
    const currentContent = context.vizUrdfContent ?? null;
    if (previousUrdfContentRef.current !== currentContent) {
      setIsEndEffectorSelectionManual(false);
      previousUrdfContentRef.current = currentContent;
    }
  }, [context.vizUrdfContent]);

  // Keep end-effector selection valid and auto-derive candidates from URDF topology.
  useEffect(() => {
    const { vizUrdfContent, availableLinks = [], urdfAnalysis } = context;
    if (!vizUrdfContent) return;
    const candidates = urdfAnalysis?.isValid
      ? findAutoEndEffectorLinksFromAnalysis(urdfAnalysis)
      : [];
    setEndEffectorCandidates(candidates);

    if (isEndEffectorSelectionManual) {
      if (endEffectorLink === null) {
        return;
      }
      if (endEffectorLink && availableLinks.includes(endEffectorLink)) {
        return;
      }
      // Manual link became invalid (e.g. new robot loaded): fall back to auto.
      setIsEndEffectorSelectionManual(false);
    }

    if (endEffectorLink && availableLinks.includes(endEffectorLink)) return;

    if (candidates.length === 1) {
      setEndEffectorLinkState(candidates[0]);
      return;
    }
    if (candidates.length > 1) {
      setEndEffectorLinkState(null);
      return;
    }

    const fallbackCandidate = findDeepestLeafLink(vizUrdfContent);
    if (fallbackCandidate) {
      setEndEffectorLinkState(fallbackCandidate);
      return;
    }
    if (!availableLinks.length) {
      setEndEffectorLinkState(null);
    }
  }, [context, endEffectorLink, isEndEffectorSelectionManual]);

  const setJointValue = useCallback(
    (jointName: string, value: number, options?: SetJointValueOptions) =>
      setStoreJointValue(jointName, value, options),
    [setStoreJointValue]
  );

  const setJointValues = useCallback(
    (values: Record<string, number>) => setStoreJointValues(values),
    [setStoreJointValues]
  );

  const toggleDeletedJoint = useCallback((jointName: string) => {
    setDeletedJoints((prev) => {
      const next = new Set(prev);
      if (next.has(jointName)) {
        next.delete(jointName);
      } else {
        next.add(jointName);
      }
      return next;
    });
  }, []);

  const selectionState = useMemo(
    () => ({
      selectedJoint,
      setSelectedJoint,
      selectedLink,
      setSelectedLink,
      hoveredJoint,
      setHoveredJoint,
      hoveredLink,
      setHoveredLink,
      endEffectorLink,
      setEndEffectorLink,
      autoEndEffectorFallbackEnabled: !(
        isEndEffectorSelectionManual && endEffectorLink === null
      ),
      endEffectorCandidates,
      deletedJoints,
      toggleDeletedJoint,
      clearSelection,
      jointValues,
      setJointValue,
      setJointValues,
      setContext,
    }),
    [
      selectedJoint,
      selectedLink,
      hoveredJoint,
      hoveredLink,
      endEffectorLink,
      setEndEffectorLink,
      isEndEffectorSelectionManual,
      endEffectorCandidates,
      deletedJoints,
      toggleDeletedJoint,
      clearSelection,
      jointValues,
      setJointValue,
      setJointValues,
      setContext,
    ]
  );

  return selectionState;
};
