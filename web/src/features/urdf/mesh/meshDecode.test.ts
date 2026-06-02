/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { isDefaultMeshMaterial } from "@runtime-private/urdf/meshMaterialPayload";
import { loadMeshFromBlob } from "./meshDecode";

const COLLADA_RED_TRIANGLE = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <unit name="meter" meter="1"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>
    <effect id="red-effect">
      <profile_COMMON>
        <technique sid="common">
          <phong>
            <diffuse><color>0.8 0.1 0.1 1</color></diffuse>
          </phong>
        </technique>
      </profile_COMMON>
    </effect>
  </library_effects>
  <library_materials>
    <material id="red-material" name="red-material">
      <instance_effect url="#red-effect"/>
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
        <triangles material="red-material" count="1">
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
              <instance_material symbol="red-material" target="#red-material"/>
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

const ASCII_STL_TRIANGLE = `solid triangle
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid triangle`;
const EXPECTED_STL_BLOB_READ_LIMIT_WITH_WORKER_FALLBACK = 2;

describe("meshDecode", () => {
  it("coalesces duplicate STL blob reads while the first decode is in flight", async () => {
    const sourceBlob = new Blob([ASCII_STL_TRIANGLE], { type: "model/stl" });
    const readSourceBlob = sourceBlob.arrayBuffer.bind(sourceBlob);
    const arrayBufferSpy = vi.fn(() => readSourceBlob());
    Object.defineProperty(sourceBlob, "arrayBuffer", {
      value: arrayBufferSpy,
      configurable: true,
    });

    const [firstResult, secondResult] = await Promise.all([
      loadMeshFromBlob({
        blob: sourceBlob,
        path: "demo_robot/meshes/visual/triangle.stl",
        gpuMode: "high",
      }),
      loadMeshFromBlob({
        blob: sourceBlob,
        path: "demo_robot/meshes/visual/triangle.stl",
        gpuMode: "high",
      }),
    ]);

    expect(firstResult?.object).toBeDefined();
    expect(secondResult?.object).toBeDefined();
    expect(arrayBufferSpy.mock.calls.length).toBeLessThanOrEqual(
      EXPECTED_STL_BLOB_READ_LIMIT_WITH_WORKER_FALLBACK
    );
  });

  it("preserves imported Collada material colors across cached reloads", async () => {
    const sourceBlob = new Blob([COLLADA_RED_TRIANGLE], { type: "model/vnd.collada+xml" });
    const firstResult = await loadMeshFromBlob({
      blob: sourceBlob,
      path: "demo_robot/meshes/visual/red_triangle.dae",
      gpuMode: "high",
    });
    const secondResult = await loadMeshFromBlob({
      blob: sourceBlob,
      path: "demo_robot/meshes/visual/red_triangle.dae",
      gpuMode: "high",
    });

    const firstMesh = firstResult?.object.getObjectByProperty("type", "Mesh") as THREE.Mesh | undefined;
    const secondMesh = secondResult?.object.getObjectByProperty("type", "Mesh") as THREE.Mesh | undefined;

    expect(firstMesh).toBeDefined();
    expect(secondMesh).toBeDefined();
    expect(firstMesh?.material).toBeInstanceOf(THREE.Material);
    expect(secondMesh?.material).toBeInstanceOf(THREE.Material);

    const firstMaterial = firstMesh?.material as THREE.MeshPhongMaterial;
    const secondMaterial = secondMesh?.material as THREE.MeshPhongMaterial;

    expect(isDefaultMeshMaterial(firstMaterial)).toBe(false);
    expect(isDefaultMeshMaterial(secondMaterial)).toBe(false);

    [firstMaterial, secondMaterial].forEach((material) => {
      expect(material.color.r).toBeGreaterThan(0.7);
      expect(material.color.g).toBeLessThan(0.2);
      expect(material.color.b).toBeLessThan(0.2);
    });
  });
});
