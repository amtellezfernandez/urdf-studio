import { createVizFilename } from "@/features/urdf/utils/addJointColors";

export const createLoadedUrdfFile = (
  content: string,
  filename: string,
  timestamp?: number
): File => {
  const vizFilename = createVizFilename(filename);
  const uniqueFilename = timestamp
    ? `${vizFilename.replace(".urdf", "")}_${timestamp}.urdf`
    : vizFilename;
  const blob = new Blob([content], { type: "application/xml" });
  return new File([blob], uniqueFilename, { type: "application/xml" });
};

export const createExpandedXacroUrdfFile = ({
  content,
  filename,
  relativePath,
}: {
  content: string;
  filename: string;
  relativePath: string;
}): File => {
  const blob = new Blob([content], { type: "application/xml" });
  const file = new File([blob], filename, { type: "application/xml" });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: false,
    enumerable: true,
    value: relativePath,
    writable: false,
  });
  return file;
};
