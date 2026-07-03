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
  isCameraCreatorOpen: boolean;
  onCameraCreatorOpenChange: (open: boolean) => void;
  availableJoints: string[];
  robot: URDFRobot | null;
  isCameraUploadOpen: boolean;
  onCameraUploadOpenChange: (open: boolean) => void;
};

export const CreationDialogs = ({
  objectCreatorOpen,
  objectCreatorType,
  openObjectCreator,
  closeObjectCreator,
  robotBoundingBox,
  isCameraCreatorOpen,
  onCameraCreatorOpenChange,
  availableJoints,
  robot,
  isCameraUploadOpen,
  onCameraUploadOpenChange,
}: CreationDialogsProps) => (
  <>
    <ObjectCreator
      open={objectCreatorOpen}
      onOpenChange={(open) => (open ? openObjectCreator() : closeObjectCreator())}
      defaultType={objectCreatorType}
      robotBoundingBox={robotBoundingBox}
    />

    <CameraCreator
      open={isCameraCreatorOpen}
      onOpenChange={onCameraCreatorOpenChange}
      availableJoints={availableJoints}
      robot={robot}
    />

    <CameraConfigUpload open={isCameraUploadOpen} onOpenChange={onCameraUploadOpenChange} />
  </>
);
