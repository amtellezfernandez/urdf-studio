/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  computeInertialTensorDiagnostics,
  regularizeNearMissInertialTensor,
} from "./inertialDiagnostics";
import {
  INERTIAL_DIAGNOSTICS_ILL_CONDITIONED_RATIO,
  INERTIAL_DIAGNOSTICS_NEAR_MISS_TRIANGLE_GAP_EPS,
  INERTIAL_DIAGNOSTICS_PSD_EIGENVALUE_EPS,
} from "./inertialDiagnosticsParams";

describe("inertialDiagnostics", () => {
  it("flags triangle inequality violations", () => {
    const diagnostics = computeInertialTensorDiagnostics({
      ixx: 1,
      ixy: 0,
      ixz: 0,
      iyy: 1,
      iyz: 0,
      izz: 3,
    });

    expect(diagnostics.bucket).toBe("triangle-inequality");
    expect(diagnostics.triangleInequalitySatisfied).toBe(false);
    expect(diagnostics.triangleInequalityGap).toBe(-1);
  });

  it("flags non-positive-definite tensors", () => {
    const diagnostics = computeInertialTensorDiagnostics({
      ixx: -1,
      ixy: 0,
      ixz: 0,
      iyy: 1,
      iyz: 0,
      izz: 2,
    });

    expect(diagnostics.bucket).toBe("non-positive-definite");
    expect(diagnostics.positiveDefinite).toBe(false);
    expect(diagnostics.minEigenvalue).toBe(-1);
  });

  it("flags ill-conditioned tensors that are technically valid", () => {
    const minimumEigenvalue = 1 / (INERTIAL_DIAGNOSTICS_ILL_CONDITIONED_RATIO * 10);
    const diagnostics = computeInertialTensorDiagnostics({
      ixx: minimumEigenvalue,
      ixy: 0,
      ixz: 0,
      iyy: 1,
      iyz: 0,
      izz: 1,
    });

    expect(diagnostics.bucket).toBe("ill-conditioned");
    expect(diagnostics.conditionNumber).not.toBeNull();
    expect((diagnostics.conditionNumber ?? 0) > INERTIAL_DIAGNOSTICS_ILL_CONDITIONED_RATIO).toBe(true);
  });

  it("flags near-miss triangle gaps separately from hard failures", () => {
    const diagnostics = computeInertialTensorDiagnostics({
      ixx: 1,
      ixy: 0,
      ixz: 0,
      iyy: 1,
      iyz: 0,
      izz: 2 + INERTIAL_DIAGNOSTICS_NEAR_MISS_TRIANGLE_GAP_EPS / 2,
    });

    expect(diagnostics.bucket).toBe("near-miss");
    expect(diagnostics.triangleInequalityGap).toBeLessThan(0);
  });

  it("regularizes near-miss tensors into a valid PSD tensor", () => {
    const regularizedTensor = regularizeNearMissInertialTensor({
      ixx: 1,
      ixy: 0,
      ixz: 0,
      iyy: 1,
      iyz: 0,
      izz: 2 + INERTIAL_DIAGNOSTICS_NEAR_MISS_TRIANGLE_GAP_EPS / 2,
    });

    const diagnostics = computeInertialTensorDiagnostics(regularizedTensor);
    expect(diagnostics.positiveDefinite).toBe(true);
    expect(diagnostics.triangleInequalitySatisfied).toBe(true);
    expect(diagnostics.minEigenvalue).toBeGreaterThanOrEqual(INERTIAL_DIAGNOSTICS_PSD_EIGENVALUE_EPS);
  });
});
