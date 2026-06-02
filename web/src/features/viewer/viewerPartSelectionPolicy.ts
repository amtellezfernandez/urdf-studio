type ViewerPartSelectionParams = {
  jointName?: string | null;
  linkName?: string | null;
  simulationPrepPanelOpen?: boolean;
};

type ViewerPartSelection = {
  jointName: string | null;
  linkName: string | null;
};

export const resolveViewerPartSelection = ({
  jointName = null,
  linkName = null,
  simulationPrepPanelOpen = false,
}: ViewerPartSelectionParams): ViewerPartSelection => {
  if (simulationPrepPanelOpen && linkName) {
    return {
      jointName: null,
      linkName,
    };
  }

  return {
    jointName,
    linkName,
  };
};
