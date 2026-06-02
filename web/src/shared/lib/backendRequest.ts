export const BACKEND_REQUEST_ID_HEADER = "X-Request-ID";

const REQUEST_ID_RANDOM_SUFFIX_CHARS = 10;

const createBackendRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const randomSuffix = Math.random().toString(36).slice(2, 2 + REQUEST_ID_RANDOM_SUFFIX_CHARS);
  return `req-${Date.now().toString(36)}-${randomSuffix}`;
};

type CorrelatedBackendRequestOptions = {
  extraHeaders?: HeadersInit;
  requestId?: string;
};

export const withBackendRequestHeaders = (
  init?: RequestInit,
  options?: CorrelatedBackendRequestOptions
): { init: RequestInit; requestId: string } => {
  const headers = new Headers(init?.headers);
  const requestId =
    options?.requestId?.trim() || headers.get(BACKEND_REQUEST_ID_HEADER)?.trim() || createBackendRequestId();
  headers.set(BACKEND_REQUEST_ID_HEADER, requestId);

  if (options?.extraHeaders) {
    const extraHeaders = new Headers(options.extraHeaders);
    extraHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return {
    requestId,
    init: {
      ...init,
      headers,
    },
  };
};
