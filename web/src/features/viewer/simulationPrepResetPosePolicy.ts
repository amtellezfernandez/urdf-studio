type SimulationPrepResetPosePolicyParams = {
  requestKey?: string | null;
  handledRequestKey?: string | null;
};

export const shouldApplySimulationPrepResetPoseRequest = ({
  requestKey = null,
  handledRequestKey = null,
}: SimulationPrepResetPosePolicyParams): boolean =>
  requestKey !== null && requestKey !== handledRequestKey;
