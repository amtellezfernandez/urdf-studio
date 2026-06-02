import { describe, expect, it } from "vitest";

import {
  deriveNamingStatus,
  validateEpisodesForStandardizedExport,
} from "@/features/dataset/datasetAlignment";
import {
  DATASET_TREATMENT_ACTION_REQUIRES_MAPPING,
  DATASET_TREATMENT_ACTION_REQUIRES_NAMING_REVIEW,
  NAMING_STATUS_NAMED,
  NAMING_STATUS_UNNAMED,
} from "@/features/dataset/datasetAlignmentParams";
import type { Episode } from "@/features/dataset/episodes";

const buildEpisode = (overrides: Partial<Episode>): Episode => ({
  id: "episode-1",
  number: 1,
  createdAt: 1,
  frames: [
    {
      timestamp: 0,
      jointPositions: { shoulder: 0 },
    },
  ],
  metadata: {
    robot_type: "demo-bot",
    joint_names: ["shoulder"],
    ...overrides.metadata,
  },
  ...overrides,
});

describe("datasetAlignment", () => {
  it("marks placeholder joints as unnamed", () => {
    expect(deriveNamingStatus({ joint_names: ["joint_0", "joint_1"] })).toBe(
      NAMING_STATUS_UNNAMED
    );
  });

  it("marks semantic joints as named", () => {
    expect(deriveNamingStatus({ joint_names: ["arm.shoulder_pan"] })).toBe(
      NAMING_STATUS_NAMED
    );
  });

  it("fails standardized export when embodiment metadata is missing", () => {
    const episode = buildEpisode({
      metadata: {
        robot_type: "unknown",
        joint_names: ["arm.shoulder_pan"],
      },
    });

    const result = validateEpisodesForStandardizedExport([episode]);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.reason.includes("embodiment"))).toBe(true);
  });

  it("does not treat robot_type as embodiment binding", () => {
    const episode = buildEpisode({
      metadata: {
        robot_type: "franka",
        joint_names: ["arm.shoulder_pan"],
      },
    });

    const result = validateEpisodesForStandardizedExport([episode]);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.reason.includes("embodiment"))).toBe(true);
  });

  it("passes standardized export when embodiment and naming are bound", () => {
    const episode = buildEpisode({
      metadata: {
        robot_type: "unknown",
        joint_names: ["arm.shoulder_pan"],
        embodiment_ref: {
          embodiment_id: "franka:panda:v1",
        },
      },
    });

    const result = validateEpisodesForStandardizedExport([episode]);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("blocks export when backend treatment requires explicit mapping", () => {
    const episode = buildEpisode({
      metadata: {
        robot_type: "unknown",
        joint_names: ["arm.shoulder_pan"],
        embodiment_ref: {
          embodiment_id: "franka:panda:v1",
        },
        additional: {
          datasetTreatment: {
            normalization_actions: [DATASET_TREATMENT_ACTION_REQUIRES_MAPPING],
            error_codes: [],
            warning_codes: [],
          },
        },
      },
    });

    const result = validateEpisodesForStandardizedExport([episode]);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.reason.includes("mapping"))).toBe(true);
  });

  it("blocks export when backend treatment requires naming review", () => {
    const episode = buildEpisode({
      metadata: {
        robot_type: "unknown",
        joint_names: ["arm.shoulder_pan"],
        embodiment_ref: {
          embodiment_id: "franka:panda:v1",
        },
        additional: {
          datasetTreatment: {
            normalization_actions: [DATASET_TREATMENT_ACTION_REQUIRES_NAMING_REVIEW],
            error_codes: [],
            warning_codes: [],
          },
        },
      },
    });

    const result = validateEpisodesForStandardizedExport([episode]);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.reason.includes("naming"))).toBe(true);
  });
});
