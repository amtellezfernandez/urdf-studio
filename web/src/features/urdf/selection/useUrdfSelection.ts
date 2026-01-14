import { useCallback, useEffect, useMemo, useState } from "react";
import { useJointStore } from "@/shared/store/useJointStore";
import { findDeepestLeafLink } from "@/features/layout/page/utils";

type SelectionContext = {
  vizUrdfContent?: string | null;
  availableLinks?: string[];
};

export const useUrdfSelection = () => {
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [hoveredJoint, setHoveredJoint] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [endEffectorLink, setEndEffectorLink] = useState<string | null>(null);
  const [deletedJoints, setDeletedJoints] = useState<Set<string>>(new Set());
  const [context, setContextState] = useState<SelectionContext>({
    vizUrdfContent: null,
    availableLinks: [],
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
      if (prev.vizUrdfContent === next.vizUrdfContent && prev.availableLinks === next.availableLinks) {
        return prev;
      }
      return {
        vizUrdfContent: next.vizUrdfContent ?? null,
        availableLinks: next.availableLinks ?? [],
      };
    });
  }, []);

  // Keep end-effector valid and auto-select deepest leaf when none is set
  useEffect(() => {
    const { vizUrdfContent, availableLinks = [] } = context;
    if (!vizUrdfContent) return;
    if (endEffectorLink && availableLinks.includes(endEffectorLink)) return;

    const candidate = findDeepestLeafLink(vizUrdfContent);
    if (candidate) {
      setEndEffectorLink(candidate);
    } else if (!availableLinks.length) {
      setEndEffectorLink(null);
    }
  }, [context, endEffectorLink]);

  const setJointValue = useCallback(
    (jointName: string, value: number) => setStoreJointValue(jointName, value),
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
