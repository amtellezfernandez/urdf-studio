export type DemoMotionWorldPolicyInput = {
  hasLoadedFiles: boolean;
  preserveDemoWorldLayoutOnMotion: boolean;
};

export const shouldPrepareDemoWorldLayoutOnMotion = (
  prepareDemoWorldLayoutOnMotion: boolean
): boolean => prepareDemoWorldLayoutOnMotion;

export const shouldPreserveDemoWorldLayoutOnMotion = ({
  hasLoadedFiles,
  preserveDemoWorldLayoutOnMotion,
}: DemoMotionWorldPolicyInput): boolean =>
  !hasLoadedFiles || preserveDemoWorldLayoutOnMotion;
