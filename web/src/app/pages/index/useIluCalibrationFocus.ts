import { useEffect, useRef } from "react";
import { toast } from "sonner";

type UseIluCalibrationFocusParams = {
  availableJoints: string[];
  focusJoint: string;
  calibrate: boolean;
  isAttachingIluSession: boolean;
  setSelectedJoint: (jointName: string | null) => void;
  setSelectedLink: (linkName: string | null) => void;
};

export const useIluCalibrationFocus = ({
  availableJoints,
  focusJoint,
  calibrate,
  isAttachingIluSession,
  setSelectedJoint,
  setSelectedLink,
}: UseIluCalibrationFocusParams) => {
  const hasAppliedFocusRef = useRef(false);
  const hasShownCalibrationToastRef = useRef(false);

  useEffect(() => {
    if (!focusJoint || isAttachingIluSession) {
      return;
    }
    if (!availableJoints.includes(focusJoint) || hasAppliedFocusRef.current) {
      return;
    }

    hasAppliedFocusRef.current = true;
    setSelectedLink(null);
    setSelectedJoint(focusJoint);

    if (calibrate && !hasShownCalibrationToastRef.current) {
      hasShownCalibrationToastRef.current = true;
      toast.info(`Calibrate mount joint "${focusJoint}" before exporting the final URDF.`);
    }
  }, [
    availableJoints,
    calibrate,
    focusJoint,
    isAttachingIluSession,
    setSelectedJoint,
    setSelectedLink,
  ]);
};
