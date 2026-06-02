/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { fixMissingMeshReferences } from "@/shared/lib/urdfBrowser";

describe("fixMissingMeshReferences", () => {
  it("repairs mesh references against available repo-like files", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="MeshRepair">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="mesh.stl" />
      </geometry>
    </visual>
  </link>
</robot>`;

    const result = fixMissingMeshReferences(
      urdf,
      {
        "meshes/mesh.stl": new Blob(["solid mesh\nendsolid mesh\n"]),
      },
      {
        basePath: "urdf",
      }
    );

    expect(result.success).toBe(true);
    expect(result.unresolved).toEqual([]);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]?.original).toBe("mesh.stl");
    expect(result.corrections[0]?.corrected).toBe("../meshes/mesh.stl");
    expect(result.content).toContain('mesh filename="../meshes/mesh.stl"');
  });

  it("repairs meshes-to-assets aliases when the repository only exposes assets", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="MeshRepair">
  <link name="base_link">
    <collision>
      <geometry>
        <mesh filename="meshes/head.stl" />
      </geometry>
    </collision>
  </link>
</robot>`;

    const result = fixMissingMeshReferences(
      urdf,
      {
        "google_barkour_v0/assets/head.stl": new Blob(["solid mesh\nendsolid mesh\n"]),
      },
      {
        basePath: "google_barkour_v0",
      }
    );

    expect(result.success).toBe(true);
    expect(result.unresolved).toEqual([]);
    expect(result.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          original: "meshes/head.stl",
          corrected: "package://google_barkour_v0/assets/head.stl",
        }),
      ])
    );
    expect(result.content).toContain('mesh filename="package://google_barkour_v0/assets/head.stl"');
  });
});
