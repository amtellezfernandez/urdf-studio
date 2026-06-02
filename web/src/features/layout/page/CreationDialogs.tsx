import { ObjectCreator } from "@/features/objects/ObjectCreator";
import { CameraCreator } from "@/features/camera/CameraCreator";
import { CameraConfigUpload } from "@/features/camera/CameraConfigUpload";
import type { URDFRobot } from "urdf-loader";
import type * as THREE from "three";
import type { ObjectCreatorType } from "@/features/objects/useObjectCreator";

type CreationDialogsProps = {
  objectCreatorOpen: boolean;
  objectCreatorType?: ObjectCreatorType;
  openObjectCreator: (type?: ObjectCreatorType) => void;
  closeObjectCreator: () => void;
  robotBoundingBox: THREE.Box3 | null;
  showCameraCreator: boolean;
  setShowCameraCreator: (open: boolean) => void;
  availableJoints: string[];
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
  availableJoints,
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
      availableJoints={availableJoints}
      robot={robot}
    />

    <CameraConfigUpload open={showCameraUpload} onOpenChange={setShowCameraUpload} />
  </>
);
