/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import type { Episode } from "@/features/dataset";
import {
  EMPTY_EPISODE_EDITOR_HISTORY_INDEX,
  EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
} from "@/features/dataset/episode-editor/episodeEditorParams";
import { useEpisodeEditorHistoryState } from "@/features/dataset/episode-editor/useEpisodeEditorHistoryState";
import { createEpisode } from "@/features/dataset/episodes";

const FIRST_EPISODE_NUMBER = 1;
const FRAME_TIMESTAMP_SEC = 0;
const JOINT_POSITION_RAD = 0;
const SECOND_HISTORY_INDEX = 1;
const THIRD_HISTORY_INDEX = 2;

const createHistoryEpisode = (id: string): Episode =>
  createEpisode(
    id,
    FIRST_EPISODE_NUMBER,
    [{ timestamp: FRAME_TIMESTAMP_SEC, jointPositions: { joint: JOINT_POSITION_RAD } }],
    { joint_names: ["joint"] }
  );

type HistoryHookCapture = ReturnType<typeof useEpisodeEditorHistoryState>;

describe("useEpisodeEditorHistoryState", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("initializes empty and exposes undo/redo availability", async () => {
    let captured: HistoryHookCapture | null = null;
    const Harness = () => {
      captured = useEpisodeEditorHistoryState();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(captured?.editHistory).toEqual([]);
    expect(captured?.historyIndex).toBe(EMPTY_EPISODE_EDITOR_HISTORY_INDEX);
    expect(captured?.canUndo).toBe(false);
    expect(captured?.canRedo).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });


  it("appends multiple same-turn edits against the latest committed history", async () => {
    let captured: HistoryHookCapture | null = null;
    const firstEpisode = createHistoryEpisode("same-turn-first");
    const secondEpisode = createHistoryEpisode("same-turn-second");
    const thirdEpisode = createHistoryEpisode("same-turn-third");
    const Harness = () => {
      captured = useEpisodeEditorHistoryState();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      captured?.initializeHistory(firstEpisode);
    });

    let latestAppend: ReturnType<HistoryHookCapture["appendHistory"]> | null = null;
    await act(async () => {
      captured?.appendHistory(secondEpisode);
      latestAppend = captured?.appendHistory(thirdEpisode) ?? null;
    });

    expect(latestAppend?.editHistory).toEqual([
      firstEpisode,
      secondEpisode,
      thirdEpisode,
    ]);
    expect(latestAppend?.historyIndex).toBe(THIRD_HISTORY_INDEX);
    expect(captured?.editHistory).toEqual([firstEpisode, secondEpisode, thirdEpisode]);
    expect(captured?.historyIndex).toBe(THIRD_HISTORY_INDEX);

    await act(async () => {
      root.unmount();
    });
  });

  it("initializes, appends, undoes, and redoes history state", async () => {
    let captured: HistoryHookCapture | null = null;
    const firstEpisode = createHistoryEpisode("first");
    const secondEpisode = createHistoryEpisode("second");
    const Harness = () => {
      captured = useEpisodeEditorHistoryState();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      captured?.initializeHistory(firstEpisode);
    });

    expect(captured?.editHistory).toEqual([firstEpisode]);
    expect(captured?.historyIndex).toBe(EPISODE_EDITOR_INITIAL_HISTORY_INDEX);
    expect(captured?.canUndo).toBe(false);

    await act(async () => {
      captured?.appendHistory(secondEpisode);
    });

    expect(captured?.editHistory).toEqual([firstEpisode, secondEpisode]);
    expect(captured?.historyIndex).toBe(SECOND_HISTORY_INDEX);
    expect(captured?.canUndo).toBe(true);
    expect(captured?.canRedo).toBe(false);

    let undoResult: ReturnType<HistoryHookCapture["undoHistory"]> = null;
    await act(async () => {
      undoResult = captured?.undoHistory() ?? null;
    });

    expect(undoResult?.activeEpisode).toBe(firstEpisode);
    expect(captured?.historyIndex).toBe(EPISODE_EDITOR_INITIAL_HISTORY_INDEX);
    expect(captured?.canUndo).toBe(false);
    expect(captured?.canRedo).toBe(true);

    let redoResult: ReturnType<HistoryHookCapture["redoHistory"]> = null;
    await act(async () => {
      redoResult = captured?.redoHistory() ?? null;
    });

    expect(redoResult?.activeEpisode).toBe(secondEpisode);
    expect(captured?.historyIndex).toBe(SECOND_HISTORY_INDEX);
    expect(captured?.canUndo).toBe(true);
    expect(captured?.canRedo).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
