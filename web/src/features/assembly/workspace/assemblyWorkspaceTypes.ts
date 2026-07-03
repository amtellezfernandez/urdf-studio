import type { PackageRootMap } from "@/shared/lib/urdfBrowser";

export type AssemblySubstitutionSession = {
  hostRobotId: string;
  hostRobotName: string;
  hostUrdfPath: string;
  hostUrdfContent: string;
  hostLinkOptions: string[];
  replacementRobotId: string;
  replacementRobotName: string;
  replacementUrdfPath: string;
  replacementUrdfContent: string;
  replacementLinkOptions: string[];
  replacementRootLinkOptions: string[];
  packageRoots?: PackageRootMap;
};

export type AssemblySubstitutionApplyHandler = (
  hostRootLink: string,
  replacementRootLink: string
) => void;
