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
      pose: [0.12, 0, 0.34, 0, 1.2217304763960306, 0],
      intrinsics: {
        width: 1280,
        height: 720,
        fov_deg: 78,
      },
    },
    {
      name: "so101_gripper_down",
      parent_joint: "gripper_frame_joint",
      pose: [0, 0, 0.045, 0, 1.5707963267948966, 0],
      intrinsics: {
        width: 1280,
        height: 720,
        fov_deg: 72,
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
