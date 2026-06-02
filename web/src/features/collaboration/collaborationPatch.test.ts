import { describe, expect, it } from "vitest";

import {
  applyCollaborationUrdfPatchPayload,
  buildCollaborationUrdfPatchPayload,
  hashCollaborationContent,
} from "@/features/collaboration/collaborationPatch";
import {
  COLLABORATION_DEFAULT_URDF_FILENAME,
  COLLABORATION_PATCH_REVISION_INCREMENT,
} from "@/features/collaboration/collaborationParams";

const REPEATED_LINK_COUNT = 90;
const BASE_REVISION = 3;
const PATCH_CLIENT_SEQUENCE = 11;
const PATCH_CLIENT_SENT_AT_MS = 123;
const OUT_OF_RANGE_DELETE_COUNT = 100_000;
const buildLargeUrdf = (middle = "") =>
  `<robot name="demo">${Array.from({ length: REPEATED_LINK_COUNT }, (_, index) => `<link name="l${index}"/>`).join("")}${middle}</robot>`;

describe("collaborationPatch", () => {
  it("builds and applies compact replacement patches", () => {
    const previousContent = buildLargeUrdf();
    const nextContent = buildLargeUrdf(`<joint name="new_joint" type="fixed"/>`);
    const patch = buildCollaborationUrdfPatchPayload({
      activePath: COLLABORATION_DEFAULT_URDF_FILENAME,
      basePath: "",
      baseRevision: BASE_REVISION,
      clientSequence: PATCH_CLIENT_SEQUENCE,
      clientSentAtMs: PATCH_CLIENT_SENT_AT_MS,
      filename: COLLABORATION_DEFAULT_URDF_FILENAME,
      nextContent,
      previousContent,
    });

    expect(patch).toBeTruthy();
    expect(patch?.baseRevision).toBe(BASE_REVISION);
    expect(patch?.clientSequence).toBe(PATCH_CLIENT_SEQUENCE);
    expect(patch?.revision).toBe(BASE_REVISION + COLLABORATION_PATCH_REVISION_INCREMENT);
    expect(patch?.insert).toContain("new_joint");

    const applied = applyCollaborationUrdfPatchPayload({
      currentContent: previousContent,
      currentRevision: BASE_REVISION,
      patch: patch!,
    });

    expect(applied).toEqual({
      ok: true,
      content: nextContent,
      revision: BASE_REVISION + COLLABORATION_PATCH_REVISION_INCREMENT,
      contentHash: hashCollaborationContent(nextContent),
    });
  });

  it("rejects patches when the local base has diverged", () => {
    const previousContent = buildLargeUrdf();
    const nextContent = buildLargeUrdf(`<joint name="new_joint" type="fixed"/>`);
    const patch = buildCollaborationUrdfPatchPayload({
      activePath: COLLABORATION_DEFAULT_URDF_FILENAME,
      basePath: "",
      baseRevision: BASE_REVISION,
      clientSequence: PATCH_CLIENT_SEQUENCE,
      filename: COLLABORATION_DEFAULT_URDF_FILENAME,
      nextContent,
      previousContent,
    });

    expect(
      applyCollaborationUrdfPatchPayload({
        currentContent: buildLargeUrdf(`<link name="local"/>`),
        currentRevision: BASE_REVISION,
        patch: patch!,
      })
    ).toEqual({ ok: false, reason: "patch-base-mismatch" });
  });

  it("rejects patches with invalid ranges before applying", () => {
    const previousContent = buildLargeUrdf();
    const nextContent = buildLargeUrdf(`<joint name="new_joint" type="fixed"/>`);
    const patch = buildCollaborationUrdfPatchPayload({
      activePath: COLLABORATION_DEFAULT_URDF_FILENAME,
      basePath: "",
      baseRevision: BASE_REVISION,
      clientSequence: PATCH_CLIENT_SEQUENCE,
      filename: COLLABORATION_DEFAULT_URDF_FILENAME,
      nextContent,
      previousContent,
    });

    expect(
      applyCollaborationUrdfPatchPayload({
        currentContent: previousContent,
        currentRevision: BASE_REVISION,
        patch: {
          ...patch!,
          deleteCount: OUT_OF_RANGE_DELETE_COUNT,
        },
      })
    ).toEqual({ ok: false, reason: "patch-apply-failed" });
  });
});
