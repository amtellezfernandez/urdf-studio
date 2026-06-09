import {
  OPENARM_HF_LIVE_CAMERA_RPY_RAD,
  OPENARM_HF_LIVE_REAL_SENSE_POSITION_M,
} from "@/features/teleop/perception/openArmHfLiveParams";

const FOLDER_UPLOAD_TEST_SCALARS = {
  TEST_GITHUB_OWNER: "google-deepmind",
  TEST_GITHUB_REPO: "mujoco_menagerie",
  TEST_GITHUB_BRANCH: "main",
  TEST_PRIMARY_CANDIDATE_PATH: "google_barkour_v0/barkour_v0.urdf",
  TEST_PRIMARY_CANDIDATE_FILE: "barkour_v0.urdf",
  TEST_SECONDARY_CANDIDATE_PATH:
    "google_barkour_vb/barkour_vb_rev_1_0_head_straight.urdf",
  TEST_SECONDARY_CANDIDATE_FILE: "barkour_vb_rev_1_0_head_straight.urdf",
} as const;

export const {
  TEST_GITHUB_OWNER,
  TEST_GITHUB_REPO,
  TEST_GITHUB_BRANCH,
  TEST_PRIMARY_CANDIDATE_PATH,
  TEST_PRIMARY_CANDIDATE_FILE,
  TEST_SECONDARY_CANDIDATE_PATH,
  TEST_SECONDARY_CANDIDATE_FILE,
} = FOLDER_UPLOAD_TEST_SCALARS;

export const TEST_GITHUB_SOURCE = `${TEST_GITHUB_OWNER}/${TEST_GITHUB_REPO}`;
export const TEST_GITHUB_RESOLVED_SOURCE = `https://github.com/${TEST_GITHUB_OWNER}/${TEST_GITHUB_REPO}/tree/${TEST_GITHUB_BRANCH}`;
export const TEST_OPENARM_CAMERA_CONFIG_BODY = JSON.stringify({
  cameras: [
    {
      name: "openarm_depth_camera",
      parent_joint: "openarm_body_world_joint",
      pose: [
        ...OPENARM_HF_LIVE_REAL_SENSE_POSITION_M,
        ...OPENARM_HF_LIVE_CAMERA_RPY_RAD,
      ],
      intrinsics: {
        width: 1280,
        height: 720,
        fov_deg: 70,
      },
    },
  ],
});
export const TEST_SO101_CAMERA_CONFIG_BODY = JSON.stringify({
  cameras: [
    {
      name: "so101_overhead_scene",
      parent_joint: "base_link",
      pose: [0.2, 0.02, 0.75, 0, 1.3909428270024187, 0],
      intrinsics: {
        width: 1280,
        height: 720,
        fov_deg: 78,
        fx: 790.334180182433,
        fy: 444.5629763526186,
        cx: 640,
        cy: 360,
      },
    },
    {
      name: "so101_gripper_down",
      parent_joint: "gripper_frame_joint",
      pose: [
        0,
        0,
        0.045,
        -2.9287597456336267,
        0.5047613939080733,
        0.055446603046238024,
      ],
      intrinsics: {
        width: 1280,
        height: 720,
        fov_deg: 72,
        fx: 880.8844291015512,
        fy: 495.49749136962254,
        cx: 640,
        cy: 360,
      },
    },
    {
      name: "so101_port_oblique",
      parent_joint: "base_link",
      pose: [
        0.52,
        -0.38,
        0.34,
        6.740378120644072e-17,
        0.6031350448467916,
        2.014244663214635,
      ],
      intrinsics: {
        width: 1280,
        height: 720,
        fov_deg: 88,
        fx: 662.7394008259645,
        fy: 372.79091296460507,
        cx: 640,
        cy: 360,
      },
    },
  ],
});

export const galleryJobFactory = () => ({
  jobId: "gallery-job-1",
  status: "completed",
  phase: "inspect",
  source: {
    owner: TEST_GITHUB_OWNER,
    repo: TEST_GITHUB_REPO,
    path: "",
    branch: TEST_GITHUB_BRANCH,
  },
  repoMetadata: {
    org: "",
    summary: "",
    authorWebsite: "",
    authorGithub: "",
    authorX: "",
    authorLinkedin: "",
    tags: [],
    license: "",
    demo: "",
    contact: "",
    hfDatasets: [],
    extra: "",
  },
  publishedRepo: null,
  items: [
    {
      id: "entry-alpha",
      title: "Alpha",
      owner: TEST_GITHUB_OWNER,
      repo: TEST_GITHUB_REPO,
      path: "",
      branch: TEST_GITHUB_BRANCH,
      urdfPath: TEST_PRIMARY_CANDIDATE_PATH,
      sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
      tags: [],
      macroTags: [],
      thumbnailUrl: "https://example.com/alpha.png",
      videoUrl: "https://example.com/alpha.webm",
      previewUrl: "https://example.com/alpha-preview.webm",
      robotTraits: null,
    },
    {
      id: "entry-beta",
      title: "Beta",
      owner: TEST_GITHUB_OWNER,
      repo: TEST_GITHUB_REPO,
      path: "",
      branch: TEST_GITHUB_BRANCH,
      urdfPath: TEST_SECONDARY_CANDIDATE_PATH,
      sourceFile: TEST_SECONDARY_CANDIDATE_FILE,
      tags: [],
      macroTags: [],
      thumbnailUrl: "https://example.com/beta.png",
      videoUrl: "https://example.com/beta.webm",
      previewUrl: "https://example.com/beta-preview.webm",
      robotTraits: null,
    },
  ],
  progress: null,
  error: null,
});
