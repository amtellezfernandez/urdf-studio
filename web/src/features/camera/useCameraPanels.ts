import { useState } from "react";

export const useCameraPanels = () => {
  const [isCameraCreatorOpen, setIsCameraCreatorOpen] = useState(false);
  const [isCameraUploadOpen, setIsCameraUploadOpen] = useState(false);
  const [isPovCamerasOverlayOpen, setIsPovCamerasOverlayOpen] = useState(false);

  return {
    isCameraCreatorOpen,
    setIsCameraCreatorOpen,
    isCameraUploadOpen,
    setIsCameraUploadOpen,
    isPovCamerasOverlayOpen,
    setIsPovCamerasOverlayOpen,
  };
};
