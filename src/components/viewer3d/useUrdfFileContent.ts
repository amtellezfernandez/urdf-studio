import { useEffect, useRef, useState } from "react";
import type { URDFRobot } from "urdf-loader";

type UseUrdfFileContentParams = {
  urdfFile: File | null;
  robot: URDFRobot | null;
  onLinkSelect?: (linkName: string | null) => void;
  onAutoOpenFk: () => void;
};

export const useUrdfFileContent = ({
  urdfFile,
  robot,
  onLinkSelect,
  onAutoOpenFk,
}: UseUrdfFileContentParams) => {
  const [urdfContent, setUrdfContent] = useState<string | null>(null);
  const fkAutoOpenedRef = useRef(false);

  useEffect(() => {
    if (!urdfFile) {
      setUrdfContent(null);
      onLinkSelect?.(null);
      fkAutoOpenedRef.current = false;
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setUrdfContent(text);
    };
    reader.readAsText(urdfFile);
    fkAutoOpenedRef.current = false;
  }, [urdfFile, onLinkSelect]);

  useEffect(() => {
    if (!robot || !urdfContent || fkAutoOpenedRef.current) return;
    fkAutoOpenedRef.current = true;
    onAutoOpenFk();
  }, [robot, urdfContent, onAutoOpenFk]);

  return { urdfContent };
};
