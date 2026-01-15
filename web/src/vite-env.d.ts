/// <reference types="vite/client" />

declare const __URDF_CONFIG__: {
  apiBaseUrl?: string;
  rerunWebUrl?: string;
  rerunWsUrl?: string;
  ik?: {
    defaultSolverChain?: string[];
    timeouts?: {
      requestMs?: number;
      dragMs?: number;
      orbitMs?: number;
    };
    ikfast?: {
      moduleUrl?: string;
      factoryExport?: string;
      solveExport?: string;
      init?: Record<string, unknown>;
    };
  };
};

// declare module "*.urdf?raw" {
//   const content: string;
//   export default content;
// }
