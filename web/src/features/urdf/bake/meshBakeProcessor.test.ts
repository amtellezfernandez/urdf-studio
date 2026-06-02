/** @vitest-environment jsdom */
import { ColladaExporter, ColladaLoader } from "three-stdlib";
import { describe, expect, it, vi } from "vitest";
import { executeMeshBakePlan } from "./meshBakeProcessor";

const SIMPLE_OBJ = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;

const SIMPLE_DAE = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <unit name="meter" meter="1"/>
    <up_axis>Y_UP</up_axis>
  </asset>
  <library_effects>
    <effect id="grey-effect">
      <profile_COMMON>
        <technique sid="common">
          <phong>
            <diffuse><color>0.7 0.7 0.7 1</color></diffuse>
          </phong>
        </technique>
      </profile_COMMON>
    </effect>
  </library_effects>
  <library_materials>
    <material id="grey-material" name="grey-material">
      <instance_effect url="#grey-effect"/>
    </material>
  </library_materials>
  <library_geometries>
    <geometry id="triangle-geometry" name="triangle-geometry">
      <mesh>
        <source id="triangle-positions">
          <float_array id="triangle-positions-array" count="9">0 0 0 1 0 0 0 1 0</float_array>
          <technique_common>
            <accessor source="#triangle-positions-array" count="3" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="triangle-vertices">
          <input semantic="POSITION" source="#triangle-positions"/>
        </vertices>
        <triangles material="grey-material" count="1">
          <input semantic="VERTEX" source="#triangle-vertices" offset="0"/>
          <p>0 1 2</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="triangle-node" name="triangle-node">
        <instance_geometry url="#triangle-geometry">
          <bind_material>
            <technique_common>
              <instance_material symbol="grey-material" target="#grey-material"/>
            </technique_common>
          </bind_material>
        </instance_geometry>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#Scene"/>
  </scene>
</COLLADA>`;

const createTranslationBakeMatrixElements = (
  x: number,
  y: number,
  z: number
): number[] => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

describe("meshBakeProcessor", () => {
  it("bakes OBJ meshes by applying the planned transform before export", async () => {
    const result = await executeMeshBakePlan({
      plan: {
        entries: [
          {
            meshReference: "meshes/triangle.obj",
            bakeMatrixElements: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              1, 2, 3, 1,
            ],
            linkNames: ["base_link"],
            sourceEntryCount: 1,
          },
        ],
        conflicts: [],
      },
      meshFiles: {
        "robot/meshes/triangle.obj": new Blob([SIMPLE_OBJ], { type: "text/plain" }),
      },
      urdfBasePath: "robot",
    });

    expect(result.unsupported).toEqual([]);
    expect(result.overrides).toHaveLength(1);
    const bakedContent = await result.overrides[0]!.blob.text();
    expect(bakedContent).toContain("v 1 2 3");
    expect(bakedContent).toContain("v 2 2 3");
    expect(bakedContent).toContain("v 1 3 3");
  });

  it("bakes DAE meshes by applying the planned transform before export", async () => {
    const result = await executeMeshBakePlan({
      plan: {
        entries: [
          {
            meshReference: "meshes/triangle.dae",
            bakeMatrixElements: createTranslationBakeMatrixElements(2, 0, 0),
            linkNames: ["base_link"],
            sourceEntryCount: 1,
          },
        ],
        conflicts: [],
      },
      meshFiles: {
        "robot/meshes/triangle.dae": new Blob([SIMPLE_DAE], { type: "model/vnd.collada+xml" }),
      },
      urdfBasePath: "robot",
    });

    expect(result.unsupported).toEqual([]);
    expect(result.overrides).toHaveLength(1);
    const bakedContent = await result.overrides[0]!.blob.text();
    expect(bakedContent).toContain("<matrix>1 0 0 2 0 1 0 0 0 0 1 0 0 0 0 1</matrix>");
  });

  it("exports DAE texture sidecars when the Collada exporter emits them", async () => {
    const exporterSpy = vi.spyOn(ColladaExporter.prototype, "parse").mockReturnValue({
      data: SIMPLE_DAE,
      textures: [
        {
          name: "triangle_diffuse",
          ext: "png",
          data: new Uint8Array([1, 2, 3, 4]),
        },
      ],
    });

    try {
      const result = await executeMeshBakePlan({
        plan: {
          entries: [
            {
              meshReference: "meshes/triangle.dae",
              bakeMatrixElements: createTranslationBakeMatrixElements(0, 0, 0),
              linkNames: ["base_link"],
              sourceEntryCount: 1,
            },
          ],
          conflicts: [],
        },
        meshFiles: {
          "robot/meshes/triangle.dae": new Blob([SIMPLE_DAE], { type: "model/vnd.collada+xml" }),
        },
        urdfBasePath: "robot",
      });

      expect(result.unsupported).toEqual([]);
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0]?.sidecars).toHaveLength(1);
      expect(result.overrides[0]?.sidecars[0]?.filename).toBe("triangle_diffuse.png");
    } finally {
      exporterSpy.mockRestore();
    }
  });
});
