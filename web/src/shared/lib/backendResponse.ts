type BackendErrorPayload = {
  detail?: unknown;
};

export const assertBackendResponseOk = async (
  response: Response,
  fallbackMessage: string
) => {
  if (response.ok) {
    return;
  }

  let detail = fallbackMessage;
  try {
    const payload = (await response.json()) as BackendErrorPayload;
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      detail = payload.detail;
    }
  } catch {
    // Keep the caller-provided message when the backend does not return JSON.
  }
  throw new Error(detail);
};
