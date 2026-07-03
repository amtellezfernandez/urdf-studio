import { describe, expect, it } from "vitest";
import {
  buildCollaborationEmailInviteHref,
  buildCollaborationLinkLabel,
} from "@/app/pages/index/useCollaborationInviteActions";

describe("useCollaborationInviteActions helpers", () => {
  it("builds share-link labels from the active robot name", () => {
    expect(buildCollaborationLinkLabel("atlas")).toBe("atlas live edit");
    expect(buildCollaborationLinkLabel(null)).toBe("URDF Studio live edit");
  });

  it("builds encoded mailto invites for collaboration links", () => {
    const href = buildCollaborationEmailInviteHref({
      access: "editor",
      shareUrl: "https://studio.example/robot#session=abc&token=secret",
      targetEmail: "user+robot@example.com",
    });

    expect(href).toBe(
      "mailto:user%2Brobot%40example.com?subject=URDF%20Studio%20can%20edit%20link&body=Open%20this%20URDF%20Studio%20workspace%3A%20https%3A%2F%2Fstudio.example%2Frobot%23session%3Dabc%26token%3Dsecret",
    );
  });
});
