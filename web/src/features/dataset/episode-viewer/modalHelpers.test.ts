import { describe, expect, it } from "vitest";

import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { Episode } from "@/features/dataset/episodes";
import {
  applyEpisodeViewerFrameSelection,
  applyConstraintsToFrameRange,
  applyConstraintsToFrames,
  buildJointPositionYAxisTicks,
  findClosestPointOnCurve,
  formatJointPositionYAxisTick,
  resolvePlaybackCursorTimeMs,
  resolveCombinedChartValueRange,
  resolvePaddedChartValueRange,
} from "@/features/dataset/episode-viewer/modalHelpers";
import { EPISODE_VIEWER_MODAL_HELPER_PARAMS } from "@/features/dataset/episode-viewer/modalHelperParams";
import {
  resolveEpisodeJointNames,
  resolveEpisodeSignalCatalogNames,
} from "@/features/dataset/episodes";
import { EPISODE_EDITOR_INITIAL_FRAME_INDEX } from "@/features/dataset/episode-editor/episodeEditorParams";

const buildEpisode = (overrides?: Partial<Episode>): Episode => ({
  id: "episode-1",
  number: 1,
  createdAt: 0,
  frames: [
    {
      timestamp: 0,
      jointPositions: { shoulder_pan: 0, wheel_left_joint: 0 },
    },
  ],
  metadata: {},
  ...overrides,
});

describe("resolveEpisodeJointNames", () => {
  it("returns union of metadata and frame joint names", () => {
    const episode = buildEpisode({
      metadata: {
        joint_names: ["shoulder_pan", "elbow_flex"],
      },
      frames: [
        {
          timestamp: 0,
          jointPositions: {
            shoulder_pan: 0,
            wheel_left_joint: 0,
          },
        },
      ],
    });

    expect(resolveEpisodeJointNames(episode)).toEqual([
      "elbow_flex",
      "shoulder_pan",
      "wheel_left_joint",
    ]);
  });

  it("includes derived base pose channels when base pose is present", () => {
    const episode = buildEpisode({
      frames: [
        {
          timestamp: 0,
          jointPositions: {
            shoulder_pan: 0,
          },
          basePose: {
            position: { x: 0.1, y: -0.2, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
    });

    expect(resolveEpisodeJointNames(episode)).toEqual([
      "shoulder_pan",
      "theta",
      "x_mm",
      "y_mm",
    ]);
  });
});

describe("resolveEpisodeSignalCatalogNames", () => {
  it("returns a stable union of signal names across all provided episodes", () => {
    const firstEpisode = buildEpisode({
      id: "episode-1",
      frames: [
        {
          timestamp: 0,
          jointPositions: {
            shoulder_pan: 0,
            x_mm: 0,
          },
        },
      ],
    });
    const secondEpisode = buildEpisode({
      id: "episode-2",
      frames: [
        {
          timestamp: 0,
          jointPositions: {
            shoulder_pan: 0.1,
            theta: 0.2,
          },
        },
      ],
    });

    expect(
      resolveEpisodeSignalCatalogNames({
        activeEpisode: firstEpisode,
        allEpisodes: [firstEpisode, secondEpisode],
      })
    ).toEqual(["shoulder_pan", "theta", "x_mm"]);
  });

  it("falls back to active episode when allEpisodes is empty", () => {
    const activeEpisode = buildEpisode({
      frames: [
        {
          timestamp: 0,
          jointPositions: {
            elbow_flex: 0.4,
          },
        },
      ],
      metadata: {
        joint_names: ["shoulder_pan"],
      },
    });

    expect(
      resolveEpisodeSignalCatalogNames({
        activeEpisode,
        allEpisodes: [],
      })
    ).toEqual(["elbow_flex", "shoulder_pan"]);
  });
});

describe("findClosestPointOnCurve", () => {
  const CANVAS_WIDTH = 300;
  const CANVAS_HEIGHT = 200;

  it("supports a resolved-value callback for mapped or derived signals", () => {
    const episode = buildEpisode({
      frames: [
        { timestamp: 0, jointPositions: { shoulder_pan: 0 } },
        { timestamp: 100, jointPositions: { shoulder_pan: 0 } },
        { timestamp: 200, jointPositions: { shoulder_pan: 0 } },
      ],
    });
    const frameValues = [0, 1, 2];

    const closest = findClosestPointOnCurve(
      150,
      100,
      episode.frames,
      "shoulder_pan",
      { min: 0, max: 2 },
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      (_frame, frameIndex) => frameValues[frameIndex]
    );

    expect(closest).toBe(1);
  });

  it("ignores non-finite point values", () => {
    const episode = buildEpisode({
      frames: [
        { timestamp: 0, jointPositions: {} },
        { timestamp: 100, jointPositions: {} },
      ],
    });

    const closest = findClosestPointOnCurve(
      150,
      100,
      episode.frames,
      "missing_signal",
      { min: 0, max: 1 },
      CANVAS_WIDTH,
      CANVAS_HEIGHT
    );

    expect(closest).toBeNull();
  });
});

describe("applyEpisodeViewerFrameSelection", () => {
  it("applies one normalized frame to local state, preserved state, global state, and 3D playback", () => {
    const frameSelectionFixture = {
      rawFrame: 2.8,
      normalizedFrame: 2,
    };
    const calls: Array<[string, number]> = [];

    const selectedFrame = applyEpisodeViewerFrameSelection(
      frameSelectionFixture.rawFrame,
      {
        setCurrentFrame: (frame) => calls.push(["current", frame]),
        setGlobalFrame: (frame) => calls.push(["global", frame]),
        setPreservedFrame: (frame) => calls.push(["preserved", frame]),
        updateFrame: (frame) => calls.push(["viewer", frame]),
      }
    );

    expect(selectedFrame).toBe(frameSelectionFixture.normalizedFrame);
    expect(calls).toEqual([
      ["viewer", selectedFrame],
      ["current", selectedFrame],
      ["preserved", selectedFrame],
      ["global", selectedFrame],
    ]);
  });

  it("falls back to the initial frame for invalid frame input", () => {
    const calls: Array<[string, number]> = [];

    const selectedFrame = applyEpisodeViewerFrameSelection(Number.NaN, {
      setCurrentFrame: (frame) => calls.push(["current", frame]),
      setPreservedFrame: (frame) => calls.push(["preserved", frame]),
      updateFrame: (frame) => calls.push(["viewer", frame]),
    });

    expect(selectedFrame).toBe(EPISODE_EDITOR_INITIAL_FRAME_INDEX);
    expect(calls).toEqual([
      ["viewer", EPISODE_EDITOR_INITIAL_FRAME_INDEX],
      ["current", EPISODE_EDITOR_INITIAL_FRAME_INDEX],
      ["preserved", EPISODE_EDITOR_INITIAL_FRAME_INDEX],
    ]);
  });
});

describe("resolvePlaybackCursorTimeMs", () => {
  const cursorFrames = [
    { timestamp: 100, jointPositions: {} },
    { timestamp: 300, jointPositions: {} },
    { timestamp: 600, jointPositions: {} },
  ];

  it("extrapolates from the last playback event while playing", () => {
    const cursorTime = resolvePlaybackCursorTimeMs({
      frames: cursorFrames,
      playbackTimeMs: 300,
      lastPlaybackEventAtMs: 1000,
      nowMs: 1050,
      playbackSpeed: 2,
      isPlaying: true,
      fallbackFrameIndex: 0,
    });

    expect(cursorTime).toBe(400);
  });

  it("clamps extrapolated time to the episode timestamp range", () => {
    const cursorTime = resolvePlaybackCursorTimeMs({
      frames: cursorFrames,
      playbackTimeMs: 590,
      lastPlaybackEventAtMs: 1000,
      nowMs: 1100,
      playbackSpeed: 1,
      isPlaying: true,
      fallbackFrameIndex: 0,
    });

    expect(cursorTime).toBe(600);
  });

  it("falls back to the selected frame when playback time is invalid", () => {
    const cursorTime = resolvePlaybackCursorTimeMs({
      frames: cursorFrames,
      playbackTimeMs: Number.NaN,
      lastPlaybackEventAtMs: Number.NEGATIVE_INFINITY,
      nowMs: 1000,
      playbackSpeed: 1,
      isPlaying: false,
      fallbackFrameIndex: 1,
    });

    expect(cursorTime).toBe(300);
  });

  it("does not move backward during playback when a stale event arrives", () => {
    const cursorTime = resolvePlaybackCursorTimeMs({
      frames: cursorFrames,
      playbackTimeMs: 300,
      lastPlaybackEventAtMs: 1000,
      nowMs: 1000,
      playbackSpeed: 1,
      isPlaying: true,
      fallbackFrameIndex: 0,
      previousCursorTimeMs: 360,
    });

    expect(cursorTime).toBe(360);
  });
});

describe("joint position y-axis helpers", () => {
  const SHOULDER_JOINT = "shoulder_pan";
  const ELBOW_JOINT = "elbow_flex";
  const FLAT_SIGNAL_VALUE_RAD = 1;
  const SPANNING_SIGNAL_MIN_RAD = -2;
  const SPANNING_SIGNAL_MAX_RAD = 3;
  const ELBOW_SIGNAL_MIN_RAD = 0.5;
  const EXPECTED_FLAT_SIGNAL_PADDING_RAD =
    EPISODE_VIEWER_MODAL_HELPER_PARAMS.chartValueRangeFallbackPadding;
  const EXPECTED_SPANNING_PADDING_RAD =
    (SPANNING_SIGNAL_MAX_RAD - SPANNING_SIGNAL_MIN_RAD) *
    EPISODE_VIEWER_MODAL_HELPER_PARAMS.chartValueRangePaddingRatio;

  it("pads flat and non-flat chart ranges with centralized parameters", () => {
    const flatRange = resolvePaddedChartValueRange({
      min: FLAT_SIGNAL_VALUE_RAD,
      max: FLAT_SIGNAL_VALUE_RAD,
    });
    expect(flatRange?.min).toBeCloseTo(
      FLAT_SIGNAL_VALUE_RAD - EXPECTED_FLAT_SIGNAL_PADDING_RAD
    );
    expect(flatRange?.max).toBeCloseTo(
      FLAT_SIGNAL_VALUE_RAD + EXPECTED_FLAT_SIGNAL_PADDING_RAD
    );

    const spanningRange = resolvePaddedChartValueRange({
      min: SPANNING_SIGNAL_MIN_RAD,
      max: SPANNING_SIGNAL_MAX_RAD,
    });
    expect(spanningRange?.min).toBeCloseTo(
      SPANNING_SIGNAL_MIN_RAD - EXPECTED_SPANNING_PADDING_RAD
    );
    expect(spanningRange?.max).toBeCloseTo(
      SPANNING_SIGNAL_MAX_RAD + EXPECTED_SPANNING_PADDING_RAD
    );
  });

  it("combines selected joint ranges before drawing a shared y-axis", () => {
    const combinedRawMin = -Math.PI;
    const combinedRawMax = Math.PI;
    const combinedPadding =
      (combinedRawMax - combinedRawMin) *
      EPISODE_VIEWER_MODAL_HELPER_PARAMS.chartValueRangePaddingRatio;
    const range = resolveCombinedChartValueRange({
      signalNames: [SHOULDER_JOINT, ELBOW_JOINT],
      ranges: {
        [SHOULDER_JOINT]: { min: combinedRawMin, max: 0 },
        [ELBOW_JOINT]: { min: ELBOW_SIGNAL_MIN_RAD, max: combinedRawMax },
      },
    });

    expect(range?.min).toBeCloseTo(combinedRawMin - combinedPadding);
    expect(range?.max).toBeCloseTo(combinedRawMax + combinedPadding);
  });

  it("formats radian y-axis ticks with pi anchors when available", () => {
    const range = resolvePaddedChartValueRange({
      min: -Math.PI,
      max: Math.PI,
    });

    expect(range).not.toBeNull();
    expect(buildJointPositionYAxisTicks({ range: range!, unitLabel: "rad" })).toEqual([
      { value: -Math.PI, label: "-pi" },
      { value: 0, label: "0" },
      { value: Math.PI, label: "pi" },
    ]);
    expect(formatJointPositionYAxisTick({ value: Math.PI / 2, unitLabel: "rad" })).toBe(
      "pi/2"
    );
  });
});

describe("applyConstraintsToFrameRange", () => {
  const JOINT_NAME = "drive_joint";
  const JOINT_LIMITS: JointLimits = {
    [JOINT_NAME]: {
      type: "revolute",
      lower: -100,
      upper: 100,
      velocity: 1,
    },
  };

  it("constrains only the edited range while keeping outer frames fixed", () => {
    const episode = buildEpisode({
      frames: [
        { timestamp: 0, jointPositions: { [JOINT_NAME]: 0 } },
        { timestamp: 100, jointPositions: { [JOINT_NAME]: 0 } },
        { timestamp: 200, jointPositions: { [JOINT_NAME]: 10 } },
        { timestamp: 300, jointPositions: { [JOINT_NAME]: 0 } },
      ],
    });

    const constrained = applyConstraintsToFrameRange({
      frames: episode.frames,
      jointNames: [JOINT_NAME],
      jointLimits: JOINT_LIMITS,
      startIndex: 1,
      endIndex: 2,
    });

    expect(constrained[0]?.jointPositions[JOINT_NAME]).toBe(0);
    expect(constrained[1]?.jointPositions[JOINT_NAME]).toBe(0);
    expect(constrained[2]?.jointPositions[JOINT_NAME]).toBeCloseTo(0.1, 8);
    expect(constrained[3]?.jointPositions[JOINT_NAME]).toBe(0);
  });

  it("does not inject unconstrained catalog signals into jointPositions", () => {
    const episode = buildEpisode({
      frames: [
        { timestamp: 0, jointPositions: { [JOINT_NAME]: 0 } },
        { timestamp: 100, jointPositions: { [JOINT_NAME]: 0.5 } },
      ],
    });

    const constrained = applyConstraintsToFrames(
      episode.frames,
      [JOINT_NAME, "x_mm"],
      JOINT_LIMITS
    );

    expect(constrained[0]?.jointPositions.x_mm).toBeUndefined();
    expect(constrained[1]?.jointPositions.x_mm).toBeUndefined();
  });
});
