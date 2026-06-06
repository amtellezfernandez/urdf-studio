export type WorldLabsSo101DemoTransform = {
  scale: number;
  rotationRpy: [number, number, number];
};

export const resolveWorldLabsSo101DemoTransform = ({
  activePackageId,
  robotName,
}: {
  activePackageId: string | null | undefined;
  robotName: string | null | undefined;
}): WorldLabsSo101DemoTransform => {
  if (
    activePackageId === "world-labs-third-person-controller-open" &&
    robotName === "so101_new_calib"
  ) {
    return {
      scale: 10,
      rotationRpy: [-Math.PI / 2, 0, 0],
    };
  }

  return {
    scale: 1,
    rotationRpy: [0, 0, 0],
  };
};
