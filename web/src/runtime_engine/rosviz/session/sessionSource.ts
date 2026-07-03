import type { RosVizDataSource } from "@/runtime_engine/rosviz/types";

export type RosVizSessionSource = {
  dataSource: RosVizDataSource;
};

const isDataSource = (value: string | null): value is RosVizDataSource =>
  value === "live_ros";

export const resolveRosVizSessionSource = (
  search: string | null | undefined = typeof window !== "undefined" ? window.location.search : ""
): RosVizSessionSource => {
  const params = new URLSearchParams(search || "");

  const explicitSource = params.get("rosVizSource");

  if (isDataSource(explicitSource)) {
    return {
      dataSource: "live_ros",
    };
  }

  return {
    dataSource: "live_ros",
  };
};
