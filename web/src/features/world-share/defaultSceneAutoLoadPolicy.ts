export type DefaultWorldLayoutAutoLoadPolicyInput = {
  alreadyApplied: boolean;
  hasLoadedFiles: boolean;
  defaultWorldLayoutUrl: string;
  demoMode: boolean;
  demoAutoload: boolean;
  hasExplicitWorldImport: boolean;
  hasExplicitWorldLayoutImport: boolean;
  suppressAutoImport?: boolean;
};

export const hasExplicitWorldImportRequest = (
  importUrl: string,
  packageId: string,
  version: string
): boolean =>
  importUrl.trim().length > 0 || (packageId.trim().length > 0 && version.trim().length > 0);

export const shouldAutoImportDefaultWorldLayout = ({
  alreadyApplied,
  hasLoadedFiles,
  defaultWorldLayoutUrl,
  demoMode: _demoMode,
  demoAutoload: _demoAutoload,
  hasExplicitWorldImport,
  hasExplicitWorldLayoutImport,
  suppressAutoImport = false,
}: DefaultWorldLayoutAutoLoadPolicyInput): boolean => {
  if (suppressAutoImport) return false;
  if (alreadyApplied) return false;
  if (!hasLoadedFiles) return false;
  if (!defaultWorldLayoutUrl.trim()) return false;
  // Explicit imports always win over implicit defaults.
  if (hasExplicitWorldImport || hasExplicitWorldLayoutImport) return false;
  return true;
};
