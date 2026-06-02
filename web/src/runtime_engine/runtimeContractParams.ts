export const RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY = "stream_base_url";
export const RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY = "token_scheme";
export const RUNTIME_VIDEO_REF_SECURITY_WARNING_KEY = "security_warning";
export const RUNTIME_VIDEO_REF_QUERY_AUTH_WARNING = "insecure_query_auth_removed";
export const RUNTIME_VIDEO_REF_INSECURE_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "auth",
  "authorization",
  "signature",
  "sig",
]);
export const RUNTIME_VIDEO_REF_INSECURE_TOKEN_SCHEME = "query";
