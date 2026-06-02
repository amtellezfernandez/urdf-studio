import { API_BASE_URL } from "@/shared/config/api";

type HfFetch = typeof fetch;

const HF_PROXY_ENDPOINT = `${API_BASE_URL}/datasets/hf-proxy`;

const isNetworkFetchFailure = (error: unknown): boolean => {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name !== "AbortError";
  }
  if (error instanceof TypeError) {
    return true;
  }
  return error instanceof Error && /Failed to fetch|NetworkError|fetch failed|Load failed/i.test(error.message);
};

const buildProxyRequest = (url: string, init: RequestInit | undefined): [string, RequestInit] => {
  const proxyUrl = new URL(
    HF_PROXY_ENDPOINT,
    globalThis.location?.origin ?? "http://localhost"
  );
  proxyUrl.searchParams.set("url", url);
  const headers = new Headers(init?.headers);
  const proxyHeaders = new Headers();
  const authorization = headers.get("Authorization");
  if (authorization) {
    proxyHeaders.set("Authorization", authorization);
  }
  return [
    proxyUrl.toString(),
    {
      method: "GET",
      headers: proxyHeaders,
      signal: init?.signal,
    },
  ];
};

export const fetchHfResource: HfFetch = async (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!isNetworkFetchFailure(error)) {
      throw error;
    }
    const [proxyUrl, proxyInit] = buildProxyRequest(url, init);
    try {
      return await fetch(proxyUrl, proxyInit);
    } catch (proxyError) {
      if (isNetworkFetchFailure(proxyError)) {
        throw new Error(
          "Failed to fetch Hugging Face dataset. Browser and backend proxy requests both failed."
        );
      }
      throw proxyError;
    }
  }
};
