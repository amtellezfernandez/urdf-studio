import { describe, expect, it } from "vitest";

import {
  parseEpisodeJson,
  serializeEpisodeCollectionJson,
  serializeEpisodeJson,
} from "@/features/dataset/io/episodeFormat";
import {
  DEFAULT_INDEXED_REPRESENTATION_ID,
  NAMING_STATUS_UNNAMED,
} from "@/features/dataset/datasetAlignmentParams";

const FIRST_FRAME_INDEX = 0;
const SECOND_FRAME_INDEX = 1;
const BASE_POSE_PRECISION_DECIMALS = 8;
const LEROBOT_BASE_POSE_FIXTURE = {
  episodeIndex: 3,
  taskIndex: 2,
  frameCount: 2,
  fps: 50,
  jointName: "wheel_left",
  wheelValuesRad: [0.1, 0.2],
  basePoses: [
    {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
    {
      position: { x: 0.12, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0.05, w: 0.99875 },
    },
  ],
} as const;

describe("episodeFormat alignment metadata", () => {
  it("preserves embodiment and representation metadata on serialize/parse", () => {
    const raw = serializeEpisodeJson(
      [
        {
          timestamp: 0,
          joints: { "arm.shoulder_pan": 0.1 },
        },
      ],
      ["arm.shoulder_pan"],
      {
        robot_type: "franka",
        embodiment_ref: {
          embodiment_id: "franka:panda:v1",
          kinematic_fingerprint: "abc",
          kinematic_fingerprint_version: "v1",
        },
        representation_id: "rep:joint_pos_abs:semantic:v1",
        naming_status: "named",
        mapping_ids: ["map:abc"],
      }
    );

    const parsed = parseEpisodeJson(raw);

    expect(parsed.error).toBeUndefined();
    expect(parsed.metadata?.embodiment_ref).toEqual({
      embodiment_id: "franka:panda:v1",
      kinematic_fingerprint: "abc",
      kinematic_fingerprint_version: "v1",
    });
    expect(parsed.metadata?.representation_id).toBe("rep:joint_pos_abs:semantic:v1");
    expect(parsed.metadata?.naming_status).toBe("named");
    expect(parsed.metadata?.mapping_ids).toEqual(["map:abc"]);
  });

  it("marks fallback placeholder joints as unnamed", () => {
    const payload = JSON.stringify({
      episode_index: 0,
      num_frames: 1,
      fps: 50,
      robot_type: "unknown",
      data: {
        action: [[0.2, 0.3]],
      },
      metadata: {},
    });

    const parsed = parseEpisodeJson(payload);

    expect(parsed.error).toBeUndefined();
    expect(parsed.metadata?.joint_names).toEqual(["j0", "j1"]);
    expect(parsed.metadata?.naming_status).toBe(NAMING_STATUS_UNNAMED);
    expect(parsed.metadata?.representation_id).toBe(DEFAULT_INDEXED_REPRESENTATION_ID);
  });

  it("moves LeRobot metadata base poses onto frames for viewer playback", () => {
    const payload = JSON.stringify({
      episode_index: LEROBOT_BASE_POSE_FIXTURE.episodeIndex,
      task_index: LEROBOT_BASE_POSE_FIXTURE.taskIndex,
      num_frames: LEROBOT_BASE_POSE_FIXTURE.frameCount,
      fps: LEROBOT_BASE_POSE_FIXTURE.fps,
      robot_type: "amr",
      data: {
        action: LEROBOT_BASE_POSE_FIXTURE.wheelValuesRad.map((value) => [value]),
        frame_index: [FIRST_FRAME_INDEX, SECOND_FRAME_INDEX],
      },
      metadata: {
        joint_names: [LEROBOT_BASE_POSE_FIXTURE.jointName],
        base_poses: LEROBOT_BASE_POSE_FIXTURE.basePoses,
      },
    });

    const parsed = parseEpisodeJson(payload);
    const firstFrame = parsed.frames?.[FIRST_FRAME_INDEX];
    const secondFrame = parsed.frames?.[SECOND_FRAME_INDEX];

    expect(parsed.error).toBeUndefined();
    expect(firstFrame?.joints.wheel_left).toBe(
      LEROBOT_BASE_POSE_FIXTURE.wheelValuesRad[FIRST_FRAME_INDEX]
    );
    expect(secondFrame?.joints.wheel_left).toBe(
      LEROBOT_BASE_POSE_FIXTURE.wheelValuesRad[SECOND_FRAME_INDEX]
    );
    expect(firstFrame?.base_pose?.position.x).toBeCloseTo(
      LEROBOT_BASE_POSE_FIXTURE.basePoses[FIRST_FRAME_INDEX].position.x,
      BASE_POSE_PRECISION_DECIMALS
    );
    expect(secondFrame?.base_pose?.position.x).toBeCloseTo(
      LEROBOT_BASE_POSE_FIXTURE.basePoses[SECOND_FRAME_INDEX].position.x,
      BASE_POSE_PRECISION_DECIMALS
    );
    expect(secondFrame?.base_pose?.quaternion.z).toBeCloseTo(
      LEROBOT_BASE_POSE_FIXTURE.basePoses[SECOND_FRAME_INDEX].quaternion.z,
      BASE_POSE_PRECISION_DECIMALS
    );
    expect(parsed.metadata?.base_poses).toBeUndefined();
  });

  it("round-trips per-frame base pose metadata", () => {
    const raw = serializeEpisodeJson(
      [
        {
          timestamp: 0,
          joints: { wheel_left: 0.0, wheel_right: 0.0 },
          base_pose: {
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
        {
          timestamp: 20,
          joints: { wheel_left: 0.1, wheel_right: 0.1 },
          base_pose: {
            position: { x: 0.02, y: 0, z: 0 },
            quaternion: { x: 0, y: 0.01, z: 0, w: 0.99995 },
          },
        },
      ],
      ["wheel_left", "wheel_right"],
      { robot_type: "amr" }
    );

    const parsed = parseEpisodeJson(raw);
    expect(parsed.error).toBeUndefined();
    expect(parsed.frames?.[0]?.base_pose?.position.x).toBeCloseTo(0, 8);
    expect(parsed.frames?.[1]?.base_pose?.position.x).toBeCloseTo(0.02, 8);
    expect(parsed.frames?.[1]?.base_pose?.quaternion.y).toBeCloseTo(0.01, 8);
    expect(parsed.metadata?.base_poses).toBeUndefined();
  });

  it("preserves dataset treatment manifest in collection metadata", () => {
    const raw = serializeEpisodeCollectionJson(
      [
        {
          id: "episode-1",
          frames: [
            {
              timestamp: 0,
              joints: { "arm.shoulder_pan": 0.1 },
            },
          ],
          jointOrder: ["arm.shoulder_pan"],
          metadata: {
            robot_type: "franka",
            embodiment_ref: {
              embodiment_id: "franka:panda:v1",
            },
            additional: {
              datasetTreatmentManifest: {
                manifest_version: "v1",
                required_representation_id: "rep:joint_pos_abs:semantic:v1",
                sources: [],
                normalization_actions: [],
                warnings: [],
                errors: [],
                stats: {
                  total_sources: 1,
                  repo_source_count: 1,
                  local_source_count: 0,
                  unique_canonical_sources: 1,
                  duplicate_group_count: 0,
                  alignment_error_count: 0,
                  alignment_warning_count: 0,
                  unnamed_source_count: 0,
                  representation_ids: ["rep:joint_pos_abs:indexed:v1"],
                  embodiment_ids: ["franka:panda:v1"],
                },
              },
            },
          },
        },
      ],
      {
        robot_type: "franka",
      }
    );

    const parsed = parseEpisodeJson(raw);

    expect(parsed.error).toBeUndefined();
    expect(parsed.episodes?.[0]?.metadata?.additional).toMatchObject({
      datasetTreatmentManifest: {
        manifest_version: "v1",
        required_representation_id: "rep:joint_pos_abs:semantic:v1",
      },
    });
  });
});
