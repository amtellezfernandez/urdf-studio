import { readResponseErrorDetail } from "@/shared/lib/responseErrorDetails";

export const assertBackendResponseOk = async (
  response: Response,
  fallbackMessage: string
) => {
  if (response.ok) {
    return;
  }

  const detail = await readResponseErrorDetail(response, {
    detailKeys: ["detail"],
    fallback: fallbackMessage,
    fallbackToResponseText: false,
  });
  throw new Error(detail);
};
