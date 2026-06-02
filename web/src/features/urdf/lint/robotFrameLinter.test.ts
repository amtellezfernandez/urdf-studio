import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it, vi } from "vitest";

const CANONICAL_BOX_URDF = `
  <robot name="canonical_box">
    <link name="base_link">
      <visual>
        <origin xyz="0 0 0.2" rpy="0 0 0" />
        <geometry>
          <box size="0.4 0.2 0.4" />
        </geometry>
      </visual>
      <collision>
        <origin xyz="0 0 0.2" rpy="0 0 0" />
        <geometry>
          <box size="0.4 0.2 0.4" />
        </geometry>
      </collision>
    </link>
    <link name="arm_link">
      <visual>
        <origin xyz="0.15 0 0" rpy="0 0 0" />
        <geometry>
          <box size="0.3 0.05 0.05" />
        </geometry>
      </visual>
    </link>
    <joint name="arm_joint" type="fixed">
      <parent link="base_link" />
      <child link="arm_link" />
      <origin xyz="0 0 0.4" rpy="0 0 0" />
    </joint>
  </robot>
`;

const LEKIWI_URDF_PATH = path.resolve(process.cwd(), "web/public/demo/lekiwi.urdf");

const createOrientationCard = ({
  robotName,
  likelyUpDirection,
  likelyForwardDirection,
  wheelAxisVotes,
  wheelJointNames = [],
}: {
  robotName: string;
  likelyUpDirection: "+x" | "+y" | "+z";
  likelyForwardDirection: "+x" | "+y" | "+z";
  wheelAxisVotes: { x: number; y: number; z: number };
  wheelJointNames?: string[];
}) => ({
  schema: "i-love-urdf/robot-orientation-card",
  schemaVersion: 1,
  isValid: true,
  robotName,
  summary: {
    classification: likelyUpDirection === "+z" ? "z-up" : likelyUpDirection === "+y" ? "y-up" : "x-up",
    confidence: 0.95,
    likelyUpAxis: likelyUpDirection.slice(1),
    likelyUpDirection,
    likelyForwardAxis: likelyForwardDirection.slice(1),
    likelyForwardDirection,
    likelyLateralAxis: "y",
    likelyLateralDirection: "+y",
  },
  targetBasis: {
    up: "+z",
    forward: "+x",
  },
  spans: { x: 1, y: 1, z: 1 },
  jointAxisVotes: { x: 0, y: 0, z: 0 },
  wheelAxisVotes,
  wheelJointNames,
  signals: [],
  report: { evidence: [], conflicts: [] },
  assumptions: [],
  suggestedRotate90: null,
  suggestedApplyOrientation: null,
});

const importLinterWithOrientationCard = async (
  mockedCard: ReturnType<typeof createOrientationCard>
) => {
  vi.resetModules();
  vi.doMock("@/shared/lib/urdfCore", async () => {
    const actual = await vi.importActual<typeof import("@/shared/lib/urdfCore")>("@/shared/lib/urdfCore");
    return {
      ...actual,
      buildRobotOrientationCard: () => mockedCard,
    };
  });
  return import("./robotFrameLinter");
};

describe("robotFrameLinter", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("classifies a low-compensation Z-up robot as canonical", async () => {
    const { lintRobotFrame } = await importLinterWithOrientationCard(
      createOrientationCard({
        robotName: "canonical_box",
        likelyUpDirection: "+z",
        likelyForwardDirection: "+x",
        wheelAxisVotes: { x: 0, y: 0, z: 0 },
      })
    );
    const result = lintRobotFrame(CANONICAL_BOX_URDF);

    expect(result.verdict).toBe("canonical");
    expect(result.rewriteSafe).toBe(true);
    expect(result.transformCompensation.geometryCompensationRatio).toBe(0);
    expect(result.transformCompensation.jointCompensationRatio).toBe(0);
  });

  it("flags wheel axes aligned with the inferred up axis as unsafe to rewrite", async () => {
    const { lintRobotFrame } = await importLinterWithOrientationCard(
      createOrientationCard({
        robotName: "wheel_conflict",
        likelyUpDirection: "+z",
        likelyForwardDirection: "+x",
        wheelAxisVotes: { x: 0, y: 0, z: 4 },
        wheelJointNames: ["left_wheel_joint", "right_wheel_joint"],
      })
    );
    const result = lintRobotFrame(CANONICAL_BOX_URDF);

    expect(result.verdict).toBe("unsafe-to-rewrite");
    expect(result.wheelStats.conflictsWithLikelyUpAxis).toBe(true);
    expect(result.issues.some((issue) => issue.code === "wheel-up-axis-conflict")).toBe(true);
  });

  it("classifies the bundled LeKiwi demo asset as unsafe to rewrite", async () => {
    vi.doUnmock("@/shared/lib/urdfCore");
    vi.resetModules();
    const { lintRobotFrame } = await import("./robotFrameLinter");
    const result = lintRobotFrame(readFileSync(LEKIWI_URDF_PATH, "utf8"));

    expect(result.robotName).toBe("LeKiwi");
    expect(result.verdict).toBe("unsafe-to-rewrite");
    expect(result.rewriteSafe).toBe(false);
    expect(result.orientationCard?.summary.likelyUpDirection).toBe("+x");
    expect(result.transformCompensation.geometryCompensationRatio).toBeGreaterThan(0.45);
    expect(result.transformCompensation.jointCompensationRatio).toBeGreaterThan(0.35);
    expect(result.issues.some((issue) => issue.code === "visual-compensation-debt")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "joint-compensation-debt")).toBe(true);
  });
});
