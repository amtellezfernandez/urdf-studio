/** @vitest-environment node */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset/episodes";
import { buildDatasetArchiveArtifact } from "@/features/layout/sidebar/datasetArchiveExport";

const FIXTURE_OUTPUT_ROOT_ENV = "URDF_STUDIO_FRONTEND_EXPORT_FIXTURE_ROOT";
const FIXTURE_DATASET_NAME_A = "frontend_export_a";
const FIXTURE_DATASET_NAME_B = "frontend_export_b";
const FIXTURE_ROBOT_NAME = "demo-bot";
const FIXTURE_REPRESENTATION_ID = "rep:joint_pos_abs:indexed:v1";
const FIXTURE_EMBODIMENT_ID = "demo:robot:v1";
const FIXTURE_JOINT_NAMES = ["joint_a", "joint_b"];
const FIXTURE_NAMING_STATUS = "named";

const FIXTURE_OUTPUT_ROOT = process.env[FIXTURE_OUTPUT_ROOT_ENV];

const writeArchiveToDirectory = async (blob: Blob, outputRoot: string) => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  await Promise.all(
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map(async (entry) => {
        const outputPath = path.join(outputRoot, entry.name);
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, Buffer.from(await entry.async("uint8array")));
      })
  );
};

const buildFixtureEpisodes = () => ({
  datasetA: [
    createEpisode(
      "fixture-a-episode-1",
      1,
      [
        {
          timestamp: 0,
          jointPositions: { joint_a: 0.1, joint_b: -0.2 },
        },
        {
          timestamp: 20,
          jointPositions: { joint_a: 0.2, joint_b: -0.1 },
        },
      ],
      {
        robot_type: FIXTURE_ROBOT_NAME,
        embodiment_ref: {
          embodiment_id: FIXTURE_EMBODIMENT_ID,
          robot_type: FIXTURE_ROBOT_NAME,
        },
        representation_id: FIXTURE_REPRESENTATION_ID,
        naming_status: FIXTURE_NAMING_STATUS,
        joint_names: FIXTURE_JOINT_NAMES,
        tasks: ["pick", "place"],
      }
    ),
  ],
  datasetB: [
    createEpisode(
      "fixture-b-episode-1",
      1,
      [
        {
          timestamp: 0,
          jointPositions: { joint_a: 1.1, joint_b: 1.2 },
        },
        {
          timestamp: 20,
          jointPositions: { joint_a: 1.3, joint_b: 1.4 },
        },
      ],
      {
        robot_type: FIXTURE_ROBOT_NAME,
        embodiment_ref: {
          embodiment_id: FIXTURE_EMBODIMENT_ID,
          robot_type: FIXTURE_ROBOT_NAME,
        },
        representation_id: FIXTURE_REPRESENTATION_ID,
        naming_status: FIXTURE_NAMING_STATUS,
        joint_names: FIXTURE_JOINT_NAMES,
        tasks: ["stow"],
      }
    ),
  ],
});

describe("dataset archive fixture writer", () => {
  if (!FIXTURE_OUTPUT_ROOT) {
    it("skips when no fixture output root is configured", () => {
      expect(true).toBe(true);
    });
    return;
  }

  it("writes exact no-video LeRobot archives for backend interoperability tests", async () => {
    mkdirSync(FIXTURE_OUTPUT_ROOT, { recursive: true });
    const { datasetA, datasetB } = buildFixtureEpisodes();
    const archiveA = await buildDatasetArchiveArtifact({
      episodes: datasetA,
      robotBaseName: FIXTURE_ROBOT_NAME,
      robotName: FIXTURE_ROBOT_NAME,
      availableJoints: FIXTURE_JOINT_NAMES,
      exportLimitMode: "report",
      jointLimits: {},
      loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      metricsEnabled: false,
      datasetName: FIXTURE_DATASET_NAME_A,
    });
    const archiveB = await buildDatasetArchiveArtifact({
      episodes: datasetB,
      robotBaseName: FIXTURE_ROBOT_NAME,
      robotName: FIXTURE_ROBOT_NAME,
      availableJoints: FIXTURE_JOINT_NAMES,
      exportLimitMode: "report",
      jointLimits: {},
      loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      metricsEnabled: false,
      datasetName: FIXTURE_DATASET_NAME_B,
    });

    await writeArchiveToDirectory(archiveA.blob, FIXTURE_OUTPUT_ROOT);
    await writeArchiveToDirectory(archiveB.blob, FIXTURE_OUTPUT_ROOT);

    expect(path.join(FIXTURE_OUTPUT_ROOT, FIXTURE_DATASET_NAME_A)).toContain(
      FIXTURE_DATASET_NAME_A
    );
    expect(path.join(FIXTURE_OUTPUT_ROOT, FIXTURE_DATASET_NAME_B)).toContain(
      FIXTURE_DATASET_NAME_B
    );
  });
});
