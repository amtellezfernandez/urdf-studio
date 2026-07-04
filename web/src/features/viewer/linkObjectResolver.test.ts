import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFLink, URDFRobot } from "urdf-loader";
import { createLinkObjectResolver } from "@/features/viewer/linkObjectResolver";

const createMockLink = (name: string): URDFLink => {
  const link = new THREE.Group() as unknown as URDFLink;
  link.name = name;
  link.isURDFLink = true;
  link.urdfName = name;
  link.urdfNode = null as unknown as Element;
  return link;
};

const createMockRobot = (links: Record<string, URDFLink>): URDFRobot => {
  const robot = new THREE.Group() as unknown as URDFRobot & {
    links: Record<string, URDFLink>;
  };
  robot.links = links;
  Object.values(links).forEach((link) => {
    robot.add(link);
  });
  return robot as unknown as URDFRobot;
};

describe("createLinkObjectResolver", () => {
  it("resolves exact and URI-encoded link names", () => {
    const link = createMockLink("arm link");

    const robot = createMockRobot({
      "arm link": link,
    });

    const resolve = createLinkObjectResolver(robot);
    expect(resolve("arm link")).toBe(link);
    expect(resolve("arm%20link")).toBe(link);
  });

  it("resolves namespaced aliases to the owning link object", () => {
    const link = createMockLink("robot::wrist_link");

    const robot = createMockRobot({
      "robot::wrist_link": link,
    });

    const resolve = createLinkObjectResolver(robot);
    expect(resolve("wrist_link")).toBe(link);
    expect(resolve("robot::wrist_link")).toBe(link);
  });

  it("ignores malformed link map entries without breaking alias resolution", () => {
    const link = createMockLink("valid_link");
    const robot = createMockRobot({
      valid_link: link,
    });
    (robot.links as Record<string, unknown>).malformed_link = { name: "malformed_link" };

    const resolve = createLinkObjectResolver(robot);
    expect(resolve("valid_link")).toBe(link);
    expect(resolve("malformed_link")).toBeNull();
  });
});
