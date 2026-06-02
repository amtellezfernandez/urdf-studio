export type IkObjectSolveSession = {
  token: number;
  isStale: () => boolean;
};

export const beginIkObjectSolveSession = (
  getCurrentToken: () => number,
  setCurrentToken: (token: number) => void,
  extraInvalidation?: () => boolean
): IkObjectSolveSession => {
  const token = getCurrentToken() + 1;
  setCurrentToken(token);
  return {
    token,
    isStale: () => getCurrentToken() !== token || extraInvalidation?.() === true,
  };
};
