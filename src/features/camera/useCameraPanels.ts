import { useState } from "react";

export const useCameraPanels = () => {
  const [showCameraCreator, setShowCameraCreator] = useState(false);
  const [showCameraUpload, setShowCameraUpload] = useState(false);
  const [showPovCameras, setShowPovCameras] = useState(false);

  return {
    showCameraCreator,
    setShowCameraCreator,
    showCameraUpload,
    setShowCameraUpload,
    showPovCameras,
    setShowPovCameras,
  };
};
