/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

const { guardedFetchMock } = vi.hoisted(() => ({
  guardedFetchMock: vi.fn(),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: guardedFetchMock,
}));

import {
  executeCanonicalSynthesisViaBackend,
  executeBakeExportViaBackend,
  framePreflightViaBackend,
  generatePhysicsDraftViaBackend,
  generatePhysicsPreflightViaBackend,
} from "./robotMasteringApi";

describe("robotMasteringApi", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("submits a job, polls until success, and returns the backend draft result", async () => {
    guardedFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-123",
            jobType: "generate-physics",
            status: "queued",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-123",
            jobType: "generate-physics",
            status: "succeeded",
            createdAt: "2026-03-28T10:00:00Z",
            updatedAt: "2026-03-28T10:00:01Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-123",
            jobType: "generate-physics",
            draftUrdfContent: "<robot name='draft' />",
            auditSummary: { totalLinkCount: 1 },
            synthesisResult: {
              robotName: "demo",
              repairMode: "repair-missing-invalid",
              densityPresetId: "aluminum",
              densityLabel: "Aluminum",
              results: [],
            },
            plausibilitySummary: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const result = await generatePhysicsDraftViaBackend({
      sourceUrdf: "<robot name='demo'/>",
      meshFiles: {
        "meshes/base.stl": new Blob(["solid base"], { type: "model/stl" }),
      },
      densityPresetId: "aluminum",
      repairMode: "repair-missing-invalid",
    });

    expect(result.jobId).toBe("rm-123");
    expect(result.draftUrdfContent).toBe("<robot name='draft' />");
    expect(guardedFetchMock).toHaveBeenCalledTimes(3);

    const createPayload = JSON.parse(String(guardedFetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(createPayload.jobType).toBe("generate-physics");
    expect(createPayload.meshFiles).toHaveLength(1);
    expect(createPayload.meshFiles[0]?.path).toBe("meshes/base.stl");
    expect(typeof createPayload.meshFiles[0]?.base64Content).toBe("string");
    expect(createPayload.meshFiles[0]?.base64Content.length).toBeGreaterThan(0);
    expect(createPayload.canonicalizeRepeatedMeshes).toBeUndefined();
  });

  it("passes targeted link names through to the backend job request", async () => {
    guardedFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-456",
            jobType: "generate-physics",
            status: "queued",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-456",
            jobType: "generate-physics",
            status: "succeeded",
            createdAt: "2026-03-28T10:00:00Z",
            updatedAt: "2026-03-28T10:00:01Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-456",
            jobType: "generate-physics",
            draftUrdfContent: "<robot name='draft' />",
            auditSummary: { totalLinkCount: 1 },
            synthesisResult: {
              robotName: "demo",
              repairMode: "replace-all",
              densityPresetId: "aluminum",
              densityLabel: "Aluminum",
              results: [{ linkName: "arm_link", status: "synthesized", warnings: [] }],
            },
            plausibilitySummary: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    await generatePhysicsDraftViaBackend({
      sourceUrdf: "<robot name='demo'/>",
      meshFiles: {},
      densityPresetId: "aluminum",
      repairMode: "replace-all",
      linkNames: ["arm_link"],
    });

    const createPayload = JSON.parse(String(guardedFetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(createPayload.linkNames).toEqual(["arm_link"]);
  });

  it("passes the requested mesh solve mode through to the backend job request", async () => {
    guardedFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-789",
            jobType: "generate-physics",
            status: "queued",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-789",
            jobType: "generate-physics",
            status: "succeeded",
            createdAt: "2026-03-28T10:00:00Z",
            updatedAt: "2026-03-28T10:00:01Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-789",
            jobType: "generate-physics",
            draftUrdfContent: "<robot name='draft' />",
            auditSummary: { totalLinkCount: 1 },
            synthesisResult: {
              robotName: "demo",
              repairMode: "replace-all",
              densityPresetId: "pla",
              densityLabel: "PLA",
              results: [],
            },
            plausibilitySummary: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    await generatePhysicsDraftViaBackend({
      sourceUrdf: "<robot name='demo'/>",
      meshFiles: {},
      densityPresetId: "pla",
      repairMode: "replace-all",
      linkNames: ["arm_link"],
      meshSolveMode: "voxel-only",
    });

    const createPayload = JSON.parse(String(guardedFetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(createPayload.meshSolveMode).toBe("voxel-only");
  });

  it("passes near-miss regularization through to the backend job request", async () => {
    guardedFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-790",
            jobType: "generate-physics",
            status: "queued",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-790",
            jobType: "generate-physics",
            status: "succeeded",
            createdAt: "2026-03-28T10:00:00Z",
            updatedAt: "2026-03-28T10:00:01Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-790",
            jobType: "generate-physics",
            draftUrdfContent: "<robot name='draft' />",
            auditSummary: { totalLinkCount: 1 },
            synthesisResult: {
              robotName: "demo",
              repairMode: "replace-all",
              densityPresetId: "pla",
              densityLabel: "PLA",
              regularizeNearMissTensors: true,
              results: [],
            },
            plausibilitySummary: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    await generatePhysicsDraftViaBackend({
      sourceUrdf: "<robot name='demo'/>",
      meshFiles: {},
      densityPresetId: "pla",
      repairMode: "replace-all",
      linkNames: ["arm_link"],
      meshSolveMode: "voxel-only",
      regularizeNearMissTensors: true,
    });

    const createPayload = JSON.parse(String(guardedFetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(createPayload.regularizeNearMissTensors).toBe(true);
  });

  it("passes repeated-mesh canonicalization through to the backend job request", async () => {
    guardedFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-791",
            jobType: "generate-physics",
            status: "queued",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-791",
            jobType: "generate-physics",
            status: "succeeded",
            createdAt: "2026-03-28T10:00:00Z",
            updatedAt: "2026-03-28T10:00:01Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-791",
            jobType: "generate-physics",
            draftUrdfContent: "<robot name='draft' />",
            auditSummary: { totalLinkCount: 1 },
            synthesisResult: {
              robotName: "demo",
              repairMode: "replace-all",
              densityPresetId: "pla",
              densityLabel: "PLA",
              results: [],
            },
            plausibilitySummary: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    await generatePhysicsDraftViaBackend({
      sourceUrdf: "<robot name='demo'/>",
      meshFiles: {},
      densityPresetId: "pla",
      repairMode: "replace-all",
      canonicalizeRepeatedMeshes: true,
    });

    const createPayload = JSON.parse(String(guardedFetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(createPayload.canonicalizeRepeatedMeshes).toBe(true);
  });

  it("surfaces backend job failures", async () => {
    guardedFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-123",
            jobType: "generate-physics",
            status: "queued",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "rm-123",
            jobType: "generate-physics",
            status: "failed",
            error: "worker exploded",
            createdAt: "2026-03-28T10:00:00Z",
            updatedAt: "2026-03-28T10:00:01Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    await expect(
      generatePhysicsDraftViaBackend({
        sourceUrdf: "<robot name='demo'/>",
        meshFiles: {},
        densityPresetId: "aluminum",
        repairMode: "repair-missing-invalid",
      })
    ).rejects.toThrow("worker exploded");
  });

  it("loads backend physics preflight", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          auditSummary: { totalLinkCount: 4 },
          plausibilitySummary: { verdict: "plausible" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await generatePhysicsPreflightViaBackend({
      sourceUrdf: "<robot name='demo'/>",
      meshFiles: {},
    });

    expect(result.auditSummary).toEqual({ totalLinkCount: 4 });
    expect(result.plausibilitySummary).toEqual({ verdict: "plausible" });
    expect(guardedFetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads backend frame preflight", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          orientationCard: { isValid: true, summary: { likelyUpDirection: "+z" } },
          frameLint: { verdict: "canonical", rewriteSafe: true },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await framePreflightViaBackend({
      sourceUrdf: "<robot name='demo'/>",
    });

    expect(result.orientationCard).toEqual({ isValid: true, summary: { likelyUpDirection: "+z" } });
    expect(result.frameLint).toEqual({ verdict: "canonical", rewriteSafe: true });
    expect(guardedFetchMock).toHaveBeenCalledTimes(1);
  });

  it("executes bake export via the backend and decodes baked blobs", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          overrides: [
            {
              sourceReference: "meshes/base.obj",
              resolvedPath: "robot/meshes/base.obj",
              outputFilename: "base.obj",
              blob: {
                base64Content: btoa("baked-obj"),
                mimeType: "text/plain",
              },
              sidecars: [
                {
                  filename: "base_diffuse.png",
                  blob: {
                    base64Content: btoa("pngdata"),
                    mimeType: "image/png",
                  },
                },
              ],
            },
          ],
          unsupported: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await executeBakeExportViaBackend({
      plan: {
        entries: [
          {
            meshReference: "meshes/base.obj",
            bakeMatrixElements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1],
            linkNames: ["base_link"],
            sourceEntryCount: 1,
          },
        ],
        conflicts: [],
      },
      meshFiles: {
        "robot/meshes/base.obj": new Blob(["mesh"], { type: "text/plain" }),
      },
      urdfBasePath: "robot",
    });

    expect(result.unsupported).toEqual([]);
    expect(result.overrides).toHaveLength(1);
    expect(await result.overrides[0]?.blob.text()).toBe("baked-obj");
    expect(await result.overrides[0]?.sidecars[0]?.blob.text()).toBe("pngdata");

    const requestPayload = JSON.parse(String(guardedFetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(requestPayload.planEntries).toHaveLength(1);
    expect(requestPayload.meshFiles).toHaveLength(1);
  });

  it("executes canonical synthesis via the backend", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          preview: {
            robotName: "demo_robot",
            rootLinkName: "base_link",
            linkCount: 2,
            jointCount: 1,
            supportPlane: {
              success: true,
              confidence: 1,
              evidence: "Likely +z up.",
              inferredUpAxis: "z",
              inferredUpSign: 1,
              targetUpAxis: "z",
              targetUpSign: 1,
            },
            links: [],
            joints: [],
            sampleJoints: [],
          },
          draftContent: "<robot name='draft' />",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await executeCanonicalSynthesisViaBackend({
      sourceUrdf: "<robot name='demo'/>",
      synthesisSourceUrdf: "<robot name='demo'/>",
      capturedState: {
        robotName: "demo_robot",
        supportPlane: {
          success: true,
          inferredUpAxis: "z",
          inferredUpSign: 1,
          targetUpAxis: "z",
          targetUpSign: 1,
          confidence: 1,
          alignmentQuaternion: { x: 0, y: 0, z: 0, w: 1 } as never,
          alignmentMatrix: { elements: [] } as never,
          candidates: [],
          evidence: "Likely +z up.",
        },
        capturedLinkWorldPoses: [
          {
            linkName: "base_link",
            matrixWorldElements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          },
        ],
      },
    });

    expect(result.preview.rootLinkName).toBe("base_link");
    expect(result.draftContent).toBe("<robot name='draft' />");
    const requestPayload = JSON.parse(String(guardedFetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(requestPayload.capturedLinkWorldPoses).toHaveLength(1);
    expect(requestPayload.supportPlane.success).toBe(true);
  });
});
