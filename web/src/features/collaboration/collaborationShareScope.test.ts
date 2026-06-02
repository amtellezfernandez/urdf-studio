import { describe, expect, it } from "vitest";

import { resolveCollaborationShareScope } from "@/features/collaboration/collaborationShareScope";

describe("collaborationShareScope", () => {
  it("marks localhost links as local-only", () => {
    expect(resolveCollaborationShareScope("http://localhost:5173")).toMatchObject({
      badgeLabel: "Local only",
      canEmail: false,
      kind: "local",
    });
  });

  it("marks RFC1918 addresses as LAN-only", () => {
    expect(resolveCollaborationShareScope("http://192.168.1.40:5173")).toMatchObject({
      badgeLabel: "Local network",
      canEmail: true,
      kind: "lan",
    });
    expect(resolveCollaborationShareScope("http://10.0.0.8:5173")).toMatchObject({
      kind: "lan",
    });
    expect(resolveCollaborationShareScope("http://172.20.0.8:5173")).toMatchObject({
      kind: "lan",
    });
  });

  it("marks Tailscale CGNAT and ts.net names as Tailnet-only", () => {
    expect(resolveCollaborationShareScope("http://100.64.2.10:5173")).toMatchObject({
      badgeLabel: "Tailnet",
      canEmail: true,
      kind: "tailnet",
    });
    expect(resolveCollaborationShareScope("https://robot.tailnet-name.ts.net")).toMatchObject({
      kind: "tailnet",
    });
  });

  it("marks public hostnames as explicit public URLs", () => {
    expect(resolveCollaborationShareScope("https://studio.example.com")).toMatchObject({
      badgeLabel: "Public URL",
      canEmail: true,
      kind: "public",
    });
  });
});
