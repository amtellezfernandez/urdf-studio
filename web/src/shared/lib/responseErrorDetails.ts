type ReadResponseErrorDetailOptions = {
  detailKeys?: readonly string[];
  fallback?: string;
};

export const readResponseErrorDetail = async (
  response: Response,
  {
    detailKeys = ["detail", "error"],
    fallback = response.statusText || `HTTP ${response.status}`,
  }: ReadResponseErrorDetailOptions = {}
): Promise<string> => {
  const text = (await response.text().catch(() => "")).trim();
  if (!text) return fallback;

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    for (const key of detailKeys) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return text;
  }

  return text;
};
