import { describe, expect, it } from "vitest";

import {
  cloneEpisodeForEditing,
  createEmptyEpisodeEditorDraftState,
  createEpisodeEditorDraftState,
} from "@/features/dataset/episode-editor/episodeEditorDraft";
import {
  EMPTY_EPISODE_EDITOR_HISTORY_INDEX,
  EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
} from "@/features/dataset/episode-editor/episodeEditorParams";
import { createEpisode } from "@/features/dataset/episodes";

const EPISODE_ID = "episode-editor-draft-test";
const EPISODE_NUMBER = 1;
const FIRST_TIMESTAMP_SEC = 0;
const SHOULDER_POSITION_RAD = 0.25;
const BASE_POSITION_X_METERS = 0.1;
const BASE_POSITION_Y_METERS = -0.2;
const BASE_POSITION_Z_METERS = 0.3;
const BASE_QUATERNION_X = 0;
const BASE_QUATERNION_Y = 0;
const BASE_QUATERNION_Z = 0;
const BASE_QUATERNION_W = 1;
const MUTATED_SHOULDER_POSITION_RAD = 0.75;
const MUTATED_BASE_POSITION_X_METERS = 1.5;
const DERIVED_BASE_THETA_SIGNAL_NAME = "theta";
const DERIVED_BASE_X_SIGNAL_NAME = "x_mm";
const DERIVED_BASE_Y_SIGNAL_NAME = "y_mm";
const EXPECTED_SELECTED_JOINT_NAMES = [
  "shoulder",
  DERIVED_BASE_THETA_SIGNAL_NAME,
  DERIVED_BASE_X_SIGNAL_NAME,
  DERIVED_BASE_Y_SIGNAL_NAME,
];
const EXPECTED_EDIT_HISTORY_LENGTH = 1;

const createDraftSourceEpisode = () =>
  createEpisode(
    EPISODE_ID,
    EPISODE_NUMBER,
    [
      {
        timestamp: FIRST_TIMESTAMP_SEC,
        jointPositions: { shoulder: SHOULDER_POSITION_RAD },
        basePose: {
          position: {
            x: BASE_POSITION_X_METERS,
            y: BASE_POSITION_Y_METERS,
            z: BASE_POSITION_Z_METERS,
          },
          quaternion: {
            x: BASE_QUATERNION_X,
            y: BASE_QUATERNION_Y,
            z: BASE_QUATERNION_Z,
            w: BASE_QUATERNION_W,
          },
        },
      },
    ],
    { joint_names: ["shoulder"] }
  );

describe("cloneEpisodeForEditing", () => {
  it("deep-clones mutable frame state for editor drafts", () => {
    const source = createDraftSourceEpisode();
    const cloned = cloneEpisodeForEditing(source);

    cloned.frames[0].jointPositions.shoulder = MUTATED_SHOULDER_POSITION_RAD;
    cloned.frames[0].basePose!.position.x = MUTATED_BASE_POSITION_X_METERS;

    expect(source.frames[0].jointPositions.shoulder).toBe(SHOULDER_POSITION_RAD);
    expect(source.frames[0].basePose!.position.x).toBe(BASE_POSITION_X_METERS);
  });
});

describe("createEmptyEpisodeEditorDraftState", () => {
  it("creates a single canonical empty editor draft state", () => {
    expect(createEmptyEpisodeEditorDraftState()).toEqual({
      selectedJoints: new Set(),
      modifiedEpisode: null,
      editHistory: [],
      historyIndex: EMPTY_EPISODE_EDITOR_HISTORY_INDEX,
    });
  });
});

describe("createEpisodeEditorDraftState", () => {
  it("creates the initial editable episode draft state", () => {
    const source = createDraftSourceEpisode();
    const draftState = createEpisodeEditorDraftState(source);

    expect(draftState.selectedJoints).toEqual(new Set(EXPECTED_SELECTED_JOINT_NAMES));
    expect(draftState.modifiedEpisode).not.toBe(source);
    expect(draftState.editHistory).toHaveLength(EXPECTED_EDIT_HISTORY_LENGTH);
    expect(draftState.editHistory[0]).toBe(draftState.modifiedEpisode);
    expect(draftState.historyIndex).toBe(EPISODE_EDITOR_INITIAL_HISTORY_INDEX);
  });
});
