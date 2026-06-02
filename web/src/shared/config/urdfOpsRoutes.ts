import { URDF_OPS_WEB_URL } from "@/shared/config/runtime";

const URDF_OPS_ROUTE = "/urdfops";

export const URDF_OPS_QUERY_PARAMS = {
  tab: "tab",
  dataset: "dataset",
  source: "source",
  session: "session",
} as const;

export const URDF_OPS_TABS = {
  experiments: "experiments",
  metrics: "metrics",
  datasets: "datasets",
  review: "review",
  evaluation: "evaluation",
} as const;

export type UrdfOpsTab = (typeof URDF_OPS_TABS)[keyof typeof URDF_OPS_TABS];

export type BuildUrdfOpsUrlOptions = {
  tab?: UrdfOpsTab;
  datasetId?: string;
  datasetSource?: string;
  reviewSessionId?: string | null;
};

export const URDF_OPS_DEFAULT_TAB: UrdfOpsTab = URDF_OPS_TABS.experiments;

const URDF_OPS_TAB_VALUES = new Set<string>(Object.values(URDF_OPS_TABS));

export const resolveUrdfOpsTab = (value: string | null | undefined): UrdfOpsTab => {
  if (value && URDF_OPS_TAB_VALUES.has(value)) {
    return value as UrdfOpsTab;
  }
  return URDF_OPS_DEFAULT_TAB;
};

export const buildUrdfOpsUrl = ({
  tab = URDF_OPS_DEFAULT_TAB,
  datasetId,
  datasetSource,
  reviewSessionId,
}: BuildUrdfOpsUrlOptions = {}): string => {
  const params = new URLSearchParams({ [URDF_OPS_QUERY_PARAMS.tab]: tab });
  if (datasetId) {
    params.set(URDF_OPS_QUERY_PARAMS.dataset, datasetId);
  }
  if (datasetSource) {
    params.set(URDF_OPS_QUERY_PARAMS.source, datasetSource);
  }
  if (reviewSessionId) {
    params.set(URDF_OPS_QUERY_PARAMS.session, reviewSessionId);
  }
  return `${URDF_OPS_ROUTE}?${params.toString()}`;
};

export const buildUrdfOpsBrowserUrl = (
  options: BuildUrdfOpsUrlOptions = {},
  basePath = URDF_OPS_WEB_URL,
): string => {
  const routeUrl = buildUrdfOpsUrl(options);
  const normalizedBasePath = basePath.trim().replace(/\/+$/, "");
  return normalizedBasePath && normalizedBasePath !== "/"
    ? `${normalizedBasePath}${routeUrl}`
    : routeUrl;
};

export const buildUrdfOpsTabSearchParams = (
  currentParams: URLSearchParams,
  tab: UrdfOpsTab,
): URLSearchParams => {
  const nextParams = new URLSearchParams(currentParams);
  nextParams.set(URDF_OPS_QUERY_PARAMS.tab, tab);
  return nextParams;
};
