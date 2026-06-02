import { describe, expect, it, vi } from "vitest";
import {
  createGeometryParamChangeHandler,
  createOriginChangeHandler,
  getNextGeometryParams,
  getNextOrigin,
  INVALID_MESH_PATH_MESSAGE,
} from "./geometryFieldHelpers";

const BASE_GEOMETRY_PARAMS = {
  filename: "meshes/original.stl",
  scale: "1 1 1",
};

describe("geometryFieldHelpers", () => {
  it("preserves safe mesh filenames when updating geometry params", () => {
    const { errorMessage, nextParams } = getNextGeometryParams(
      BASE_GEOMETRY_PARAMS,
      "filename",
      "meshes/robot.stl"
    );

    expect(errorMessage).toBeUndefined();
    expect(nextParams).toEqual({
      ...BASE_GEOMETRY_PARAMS,
      filename: "meshes/robot.stl",
    });
  });

  it("rejects unsafe mesh filenames without mutating params", () => {
    const { errorMessage, nextParams } = getNextGeometryParams(
      BASE_GEOMETRY_PARAMS,
      "filename",
      "../secrets/robot.stl"
    );

    expect(errorMessage).toBe(INVALID_MESH_PATH_MESSAGE);
    expect(nextParams).toBe(BASE_GEOMETRY_PARAMS);
  });

  it("updates non-filename geometry params directly", () => {
    const { errorMessage, nextParams } = getNextGeometryParams(
      BASE_GEOMETRY_PARAMS,
      "scale",
      "2 2 2"
    );

    expect(errorMessage).toBeUndefined();
    expect(nextParams).toEqual({
      ...BASE_GEOMETRY_PARAMS,
      scale: "2 2 2",
    });
  });

  it("updates a single origin axis without disturbing the rest", () => {
    const origin = {
      rpy: [0.1, 0.2, 0.3] as [number, number, number],
      xyz: [1, 2, 3] as [number, number, number],
    };

    expect(getNextOrigin(origin, "xyz", 1, 4.5)).toEqual({
      ...origin,
      xyz: [1, 4.5, 3],
    });
    expect(getNextOrigin(origin, "rpy", 2, -0.75)).toEqual({
      ...origin,
      rpy: [0.1, 0.2, -0.75],
    });
  });

  it("creates a geometry param handler that schedules valid updates", () => {
    const setGeometryParams = vi.fn();
    const scheduleUpdate = vi.fn();
    const onInvalidPath = vi.fn();
    const onBeforeSchedule = vi.fn();
    const handleParamChange = createGeometryParamChangeHandler(
      BASE_GEOMETRY_PARAMS,
      setGeometryParams,
      scheduleUpdate,
      {
        onBeforeSchedule,
        onInvalidPath,
      }
    );

    handleParamChange("scale", "2 2 2");

    expect(setGeometryParams).toHaveBeenCalledWith({
      ...BASE_GEOMETRY_PARAMS,
      scale: "2 2 2",
    });
    expect(onBeforeSchedule).toHaveBeenCalledOnce();
    expect(scheduleUpdate).toHaveBeenCalledOnce();
    expect(onInvalidPath).not.toHaveBeenCalled();
  });

  it("creates a geometry param handler that blocks invalid mesh paths", () => {
    const setGeometryParams = vi.fn();
    const scheduleUpdate = vi.fn();
    const onInvalidPath = vi.fn();
    const handleParamChange = createGeometryParamChangeHandler(
      BASE_GEOMETRY_PARAMS,
      setGeometryParams,
      scheduleUpdate,
      { onInvalidPath }
    );

    handleParamChange("filename", "../secrets/robot.stl");

    expect(onInvalidPath).toHaveBeenCalledWith(INVALID_MESH_PATH_MESSAGE);
    expect(setGeometryParams).not.toHaveBeenCalled();
    expect(scheduleUpdate).not.toHaveBeenCalled();
  });

  it("creates an origin handler that reuses the shared origin update logic", () => {
    const setOrigin = vi.fn();
    const scheduleUpdate = vi.fn();
    const onBeforeSchedule = vi.fn();
    const handleOriginChange = createOriginChangeHandler(
      setOrigin,
      scheduleUpdate,
      onBeforeSchedule
    );
    const baseOrigin = {
      rpy: [0.1, 0.2, 0.3] as [number, number, number],
      xyz: [1, 2, 3] as [number, number, number],
    };

    handleOriginChange("xyz", 1, 4.5);

    expect(setOrigin).toHaveBeenCalledOnce();
    const updater = setOrigin.mock.calls[0][0] as (origin: typeof baseOrigin) => typeof baseOrigin;
    expect(updater(baseOrigin)).toEqual({
      ...baseOrigin,
      xyz: [1, 4.5, 3],
    });
    expect(onBeforeSchedule).toHaveBeenCalledOnce();
    expect(scheduleUpdate).toHaveBeenCalledOnce();
  });
});
