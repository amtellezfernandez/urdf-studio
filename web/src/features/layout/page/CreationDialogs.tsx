import { ObjectCreator } from "@/features/objects/ObjectCreator";
import { CameraCreator } from "@/features/camera/CameraCreator";
import { CameraConfigUpload } from "@/features/camera/CameraConfigUpload";
import type { URDFRobot } from "urdf-loader";
import type * as THREE from "three";

type CreationDialogsProps = {
  objectCreatorOpen: boolean;
  objectCreatorType?: "cube" | "point";
  openObjectCreator: (type?: "cube" | "point") => void;
  closeObjectCreator: () => void;
  robotBoundingBox: THREE.Box3 | null;
  showCameraCreator: boolean;
  setShowCameraCreator: (open: boolean) => void;
  availableLinks: string[];
  robot: URDFRobot | null;
  showCameraUpload: boolean;
  setShowCameraUpload: (open: boolean) => void;
};

export const CreationDialogs = ({
  objectCreatorOpen,
  objectCreatorType,
  openObjectCreator,
  closeObjectCreator,
  robotBoundingBox,
  showCameraCreator,
  setShowCameraCreator,
  availableLinks,
  robot,
  showCameraUpload,
  setShowCameraUpload,
}: CreationDialogsProps) => (
  <>
    <ObjectCreator
      open={objectCreatorOpen}
      onOpenChange={(open) => (open ? openObjectCreator() : closeObjectCreator())}
      defaultType={objectCreatorType}
      robotBoundingBox={robotBoundingBox}
    />

    <CameraCreator
      open={showCameraCreator}
      onOpenChange={setShowCameraCreator}
      availableLinks={availableLinks}
      robot={robot}
    />

    <CameraConfigUpload open={showCameraUpload} onOpenChange={setShowCameraUpload} />
  </>
);
