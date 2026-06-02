import { describe, expect, it } from "vitest";

import type { Episode } from "@/features/dataset";
import {
  EPISODE_EDITOR_HISTORY_LIMIT,
  EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
} from "@/features/dataset/episode-editor/episodeEditorParams";
import {
  appendEpisodeEditorHistory,
  createEpisodeEditorHistoryState,
  resolveEpisodeEditorRedo,
  resolveEpisodeEditorUndo,
} from "@/features/dataset/episode-editor/episodeEditorHistory";
import { createEpisode } from "@/features/dataset/episodes";

const FIRST_EPISODE_NUMBER = 1;
const FRAME_TIMESTAMP_SEC = 0;
const JOINT_POSITION_RAD = 0;
const SMALL_HISTORY_LIMIT = 3;
const FIRST_HISTORY_INDEX = 0;
const SECOND_HISTORY_INDEX = 1;
const EXPECTED_TRUNCATED_HISTORY_LENGTH = SMALL_HISTORY_LIMIT;

const createHistoryEpisode = (id: string): Episode =>
  createEpisode(
    id,
    FIRST_EPISODE_NUMBER,
    [{ timestamp: FRAME_TIMESTAMP_SEC, jointPositions: { joint: JOINT_POSITION_RAD } }],
    { joint_names: ["joint"] }
  );

describe("createEpisodeEditorHistoryState", () => {
  it("creates the initial history state around a draft episode", () => {
    const episode = createHistoryEpisode("initial");

    expect(createEpisodeEditorHistoryState(episode)).toEqual({
      editHistory: [episode],
      historyIndex: EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
    });
  });
});

describe("appendEpisodeEditorHistory", () => {
  it("drops redo history before appending the new draft", () => {
    const first = createHistoryEpisode("first");
    const second = createHistoryEpisode("second");
    const staleRedo = createHistoryEpisode("stale-redo");
    const next = createHistoryEpisode("next");

    const result = appendEpisodeEditorHistory({
      editHistory: [first, second, staleRedo],
      historyIndex: SECOND_HISTORY_INDEX,
      nextEpisode: next,
    });

    expect(result.editHistory).toEqual([first, second, next]);
    expect(result.historyIndex).toBe(SECOND_HISTORY_INDEX + 1);
  });

  it("keeps history bounded while preserving the newest draft as active", () => {
    const first = createHistoryEpisode("first");
    const second = createHistoryEpisode("second");
    const third = createHistoryEpisode("third");
    const next = createHistoryEpisode("next");

    const result = appendEpisodeEditorHistory({
      editHistory: [first, second, third],
      historyIndex: SMALL_HISTORY_LIMIT - 1,
      nextEpisode: next,
      historyLimit: SMALL_HISTORY_LIMIT,
    });

    expect(result.editHistory).toEqual([second, third, next]);
    expect(result.editHistory).toHaveLength(EXPECTED_TRUNCATED_HISTORY_LENGTH);
    expect(result.historyIndex).toBe(SMALL_HISTORY_LIMIT - 1);
  });

  it("uses the production history limit by default", () => {
    const history = Array.from({ length: EPISODE_EDITOR_HISTORY_LIMIT }, (_, index) =>
      createHistoryEpisode(`history-${index}`)
    );
    const next = createHistoryEpisode("next");

    const result = appendEpisodeEditorHistory({
      editHistory: history,
      historyIndex: EPISODE_EDITOR_HISTORY_LIMIT - 1,
      nextEpisode: next,
    });

    expect(result.editHistory).toHaveLength(EPISODE_EDITOR_HISTORY_LIMIT);
    expect(result.editHistory.at(-1)).toBe(next);
    expect(result.historyIndex).toBe(EPISODE_EDITOR_HISTORY_LIMIT - 1);
  });
});

describe("resolveEpisodeEditorUndo", () => {
  it("returns the previous active episode when undo is possible", () => {
    const first = createHistoryEpisode("first");
    const second = createHistoryEpisode("second");

    expect(
      resolveEpisodeEditorUndo({
        editHistory: [first, second],
        historyIndex: SECOND_HISTORY_INDEX,
      })
    ).toEqual({
      editHistory: [first, second],
      historyIndex: FIRST_HISTORY_INDEX,
      activeEpisode: first,
    });
  });

  it("returns null when undo is not possible", () => {
    const first = createHistoryEpisode("first");

    expect(
      resolveEpisodeEditorUndo({
        editHistory: [first],
        historyIndex: FIRST_HISTORY_INDEX,
      })
    ).toBeNull();
  });
});

describe("resolveEpisodeEditorRedo", () => {
  it("returns the next active episode when redo is possible", () => {
    const first = createHistoryEpisode("first");
    const second = createHistoryEpisode("second");

    expect(
      resolveEpisodeEditorRedo({
        editHistory: [first, second],
        historyIndex: FIRST_HISTORY_INDEX,
      })
    ).toEqual({
      editHistory: [first, second],
      historyIndex: SECOND_HISTORY_INDEX,
      activeEpisode: second,
    });
  });

  it("returns null when redo is not possible", () => {
    const first = createHistoryEpisode("first");

    expect(
      resolveEpisodeEditorRedo({
        editHistory: [first],
        historyIndex: FIRST_HISTORY_INDEX,
      })
    ).toBeNull();
  });
});
