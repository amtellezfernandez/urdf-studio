import { describe, expect, it, vi } from "vitest";

import {
  TEAM_SHARING_UNAVAILABLE_STATUS,
  fetchTeamSharingStatus,
  setTeamSharingEnabled,
} from "@/features/collaboration/teamSharingClient";

describe("teamSharingClient", () => {
  it("reads the team sharing status endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          enabled: true,
          localUrl: "http://localhost:5173",
          teamUrl: "http://192.168.1.40:5173",
        }),
      ),
    );

    await expect(fetchTeamSharingStatus(fetcher)).resolves.toEqual({
      available: true,
      enabled: true,
      localUrl: "http://localhost:5173",
      teamUrl: "http://192.168.1.40:5173",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/__urdf_team_sharing",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("treats missing gate endpoint as unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(fetchTeamSharingStatus(fetcher)).resolves.toEqual(
      TEAM_SHARING_UNAVAILABLE_STATUS,
    );
  });

  it("posts the desired enabled state", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          enabled: false,
          localUrl: "http://localhost:5173",
          teamUrl: "http://192.168.1.40:5173",
        }),
      ),
    );

    await expect(setTeamSharingEnabled(false, fetcher)).resolves.toMatchObject({
      available: true,
      enabled: false,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/__urdf_team_sharing",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ enabled: false }) }),
    );
  });
});
