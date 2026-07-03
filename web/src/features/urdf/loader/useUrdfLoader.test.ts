/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { extractMeshReferencesFromUrdfContent, useUrdfLoader } from "./useUrdfLoader";

const createRelativeFile = (
  name: string,
  content: string,
  relativePath?: string,
  type?: string
): File => {
  const file = new File([content], name, type ? { type } : undefined);
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      enumerable: true,
      value: relativePath,
      writable: false,
    });
  }
  return file;
};

const createRepeatedLinkMeshSourceUrdf = (): string => `<?xml version="1.0"?>
<robot name="RepeatedMeshBot">
  <link name="base_link" />
  <link name="drive_motor_mount-v11" />
  <link name="drive_motor_mount-v11-2">
    <visual>
      <geometry>
        <mesh filename="meshes/drive_motor_mount-v11.stl" />
      </geometry>
    </visual>
  </link>
  <link name="ST3215_Servo_Motor-v1-2" />
  <link name="omni_wheel_mount-v5-2">
    <visual>
      <geometry>
        <mesh filename="meshes/omni_wheel_mount-v5.stl" />
      </geometry>
    </visual>
  </link>
  <link name="4-Omni-Directional-Wheel_Single_Body-v1-2">
    <visual>
      <geometry>
        <mesh filename="meshes/4-Omni-Directional-Wheel_Single_Body-v1.stl" />
      </geometry>
    </visual>
  </link>
  <joint name="base_link_to_mount" type="fixed">
    <origin xyz="-0.02 -0.1 0.0" rpy="3.141592653589793 -0.0 0.0" />
    <parent link="base_link" />
    <child link="drive_motor_mount-v11-2" />
  </joint>
  <joint name="drive_motor_mount-v11-2_Rigid-2" type="fixed">
    <origin xyz="-0.01214 -0.015999999999999997 -0.0076100000000000004" rpy="3.141592653589793 1.5707963267948966 0" />
    <parent link="drive_motor_mount-v11-2" />
    <child link="ST3215_Servo_Motor-v1-2" />
  </joint>
  <joint name="ST3215_Servo_Motor-v1-2_Revolute-60" type="continuous">
    <origin xyz="0.010249999999999999 -0.035199999999999995 -0.03275" rpy="-1.5707963267948966 1.5707963267948966 0" />
    <parent link="ST3215_Servo_Motor-v1-2" />
    <child link="omni_wheel_mount-v5-2" />
    <axis xyz="0.0 0.0 -1.0" />
  </joint>
  <joint name="omni_wheel_mount-v5-2_Rigid-61" type="fixed">
    <origin xyz="0.0 0.0 -0.007174999999999994" rpy="-1.5707963267948966 -0.0 0.0" />
    <parent link="omni_wheel_mount-v5-2" />
    <child link="4-Omni-Directional-Wheel_Single_Body-v1-2" />
  </joint>
</robot>`;

describe("extractMeshReferencesFromUrdfContent", () => {
  it("returns raw mesh references including schemes", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="TestBot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://pkg/meshes/a.stl" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <mesh filename="file:///abs/b.stl" />
      </geometry>
    </collision>
    <visual>
      <geometry>
        <mesh filename="meshes/c.stl" />
      </geometry>
    </visual>
  </link>
</robot>`;
    const refs = extractMeshReferencesFromUrdfContent(urdf);
    expect(refs).toEqual(
      expect.arrayContaining(["package://pkg/meshes/a.stl", "file:///abs/b.stl", "meshes/c.stl"])
    );
  });
});

describe("useUrdfLoader", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("rejects when selected files contain neither URDF nor Xacro", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    let capturedError: Error | null = null;
    await act(async () => {
      try {
        await loader?.loadFilesFromFolder([new File(["hello"], "notes.txt")] as unknown as FileList);
      } catch (error) {
        capturedError = error instanceof Error ? error : new Error(String(error));
      }
    });

    expect(capturedError).not.toBeNull();
    expect(capturedError?.message).toContain("No URDF or Xacro file found");

    await act(async () => {
      root.unmount();
    });
    consoleErrorSpy.mockRestore();
  });

  it("does not force a single end-effector when multiple arm EE candidates exist", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;
    const onAutoSelectEndEffector = vi.fn();

    const Harness = () => {
      loader = useUrdfLoader({ onAutoSelectEndEffector });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    const dualArmUrdf = `<?xml version="1.0"?>
<robot name="dual_arm_mobile">
  <link name="base_link" />
  <link name="wheel_left" />
  <link name="wheel_right" />
  <link name="arm_a_link_1" />
  <link name="arm_a_ee" />
  <link name="arm_b_link_1" />
  <link name="arm_b_link_2" />
  <link name="arm_b_ee" />
  <joint name="wheel_left_joint" type="continuous"><parent link="base_link" /><child link="wheel_left" /></joint>
  <joint name="wheel_right_joint" type="continuous"><parent link="base_link" /><child link="wheel_right" /></joint>
  <joint name="arm_a_joint_1" type="revolute"><parent link="base_link" /><child link="arm_a_link_1" /><limit lower="-3.14" upper="3.14" effort="100" velocity="1" /></joint>
  <joint name="arm_a_joint_2" type="revolute"><parent link="arm_a_link_1" /><child link="arm_a_ee" /><limit lower="-3.14" upper="3.14" effort="100" velocity="1" /></joint>
  <joint name="arm_b_joint_1" type="revolute"><parent link="base_link" /><child link="arm_b_link_1" /><limit lower="-3.14" upper="3.14" effort="100" velocity="1" /></joint>
  <joint name="arm_b_joint_2" type="revolute"><parent link="arm_b_link_1" /><child link="arm_b_link_2" /><limit lower="-3.14" upper="3.14" effort="100" velocity="1" /></joint>
  <joint name="arm_b_joint_3" type="revolute"><parent link="arm_b_link_2" /><child link="arm_b_ee" /><limit lower="-3.14" upper="3.14" effort="100" velocity="1" /></joint>
</robot>`;

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      const mockUrdfFile = {
        name: "dual_arm.urdf",
        text: async () => dualArmUrdf,
        size: dualArmUrdf.length,
      } as unknown as File;
      await loader?.loadFilesFromFolder(
        [mockUrdfFile] as unknown as FileList
      );
    });

    expect(onAutoSelectEndEffector).toHaveBeenCalledWith(null);

    await act(async () => {
      root.unmount();
    });
  });

  it("clears load issues after mesh references are corrected via updateUrdfFile", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;
    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    const unresolvedUrdf = `<?xml version="1.0"?>
<robot name="mesh_fix_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/wrong.stl" />
      </geometry>
    </visual>
  </link>
</robot>`;
    const resolvedUrdf = unresolvedUrdf.replace("meshes/wrong.stl", "correct.stl");
    const urdfBuffer = new TextEncoder().encode(unresolvedUrdf);
    const meshBuffer = new TextEncoder().encode("solid mesh");
    const urdfFile = {
      name: "mesh_fix_robot.urdf",
      size: urdfBuffer.byteLength,
      text: async () => unresolvedUrdf,
      arrayBuffer: async () => urdfBuffer.buffer,
    } as unknown as File;
    const meshFile = {
      name: "correct.stl",
      size: meshBuffer.byteLength,
      arrayBuffer: async () => meshBuffer.buffer,
    } as unknown as File;

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await loader?.loadFilesFromFolder([urdfFile, meshFile] as unknown as FileList);
    });

    expect(loader?.showLoadIssues).toBe(true);
    expect(loader?.unmatchedURDFRefs).toEqual(["meshes/wrong.stl"]);

    await act(async () => {
      loader?.updateUrdfFile(resolvedUrdf, "mesh_fix_robot.urdf");
    });

    expect(loader?.unmatchedURDFRefs).toEqual([]);
    expect(loader?.showLoadIssues).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("resets loaded robot state back to the empty home state", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;
    const onClearSelection = vi.fn();
    const onAutoSelectEndEffector = vi.fn();
    const Harness = () => {
      loader = useUrdfLoader({ onClearSelection, onAutoSelectEndEffector });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    const sourceUrdf = `<?xml version="1.0"?>
<robot name="reset_test">
  <link name="base_link" />
</robot>`;

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      loader?.loadUrdfText(sourceUrdf, {
        activePath: "workspace/reset_test.urdf",
        filename: "reset_test.urdf",
      });
    });

    expect(loader?.hasLoadedFiles).toBe(true);
    expect(loader?.urdfFile?.name).toContain("reset_test.urdf");
    expect(loader?.activeUrdfPath).toBe("workspace/reset_test.urdf");
    expect(loader?.vizUrdfContent).toBe(sourceUrdf);

    await act(async () => {
      loader?.resetLoadedUrdf();
    });

    expect(loader?.hasLoadedFiles).toBe(false);
    expect(loader?.urdfFile).toBeNull();
    expect(loader?.activeUrdfPath).toBeNull();
    expect(loader?.urdfDocuments).toEqual({});
    expect(loader?.meshFiles).toEqual({});
    expect(loader?.packageRoots).toEqual({});
    expect(loader?.urdfAnalysis).toBeNull();
    expect(loader?.vizUrdfContent).toBe("");
    expect(loader?.originalUrdfContent).toBe("");
    expect(loader?.showLoadIssues).toBe(false);
    expect(onClearSelection).toHaveBeenCalled();
    expect(onAutoSelectEndEffector).toHaveBeenLastCalledWith(null);

    await act(async () => {
      root.unmount();
    });
  });

  it("respects package names declared in package.xml when building package roots", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;

    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    const urdf = `<?xml version="1.0"?>
<robot name="pkg_root_test">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://custom_description/meshes/base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`;
    const urdfFile = {
      name: "robot.urdf",
      text: async () => urdf,
      size: urdf.length,
      webkitRelativePath: "workspace/robots/demo_pkg/urdf/robot.urdf",
    } as unknown as File;
    const packageXmlText = `<?xml version="1.0"?><package><name>custom_description</name></package>`;
    const packageFile = {
      name: "package.xml",
      text: async () => packageXmlText,
      size: packageXmlText.length,
      webkitRelativePath: "workspace/robots/demo_pkg/package.xml",
    } as unknown as File;
    const meshBlob = new Blob(["solid mesh"], { type: "application/sla" });
    const meshFile = {
      name: "base.stl",
      size: meshBlob.size,
      arrayBuffer: async () => meshBlob.arrayBuffer(),
      webkitRelativePath: "workspace/robots/demo_pkg/meshes/base.stl",
    } as unknown as File;

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await loader?.loadFilesFromFolder([urdfFile, packageFile, meshFile] as unknown as FileList);
    });

    expect(loader?.packageRoots).toEqual({
      custom_description: ["workspace/robots/demo_pkg"],
      demo_pkg: ["workspace/robots/demo_pkg"],
    });
    expect(loader?.missingPackageRefs).toEqual([]);
    expect(loader?.unmatchedURDFRefs).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });

  it("matches added mesh files by relative path when basenames collide", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;

    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    const urdf = `<?xml version="1.0"?>
<robot name="collision_debug_test">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/left/part.stl" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <mesh filename="meshes/right/part.stl" />
      </geometry>
    </collision>
  </link>
</robot>`;

    const leftMeshFile = createRelativeFile(
      "part.stl",
      "left mesh",
      "workspace/robot/meshes/left/part.stl",
      "application/sla"
    );
    const rightMeshFile = createRelativeFile(
      "part.stl",
      "right mesh",
      "workspace/robot/meshes/right/part.stl",
      "application/sla"
    );

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      loader?.updateUrdfFile(urdf, "collision_debug_test.urdf");
    });

    expect(loader?.unmatchedURDFRefs).toEqual([
      "meshes/left/part.stl",
      "meshes/right/part.stl",
    ]);

    let addedCount = 0;
    await act(async () => {
      addedCount =
        (await loader?.addMeshFilesFromFiles([leftMeshFile, rightMeshFile], urdf)) ?? 0;
    });

    expect(addedCount).toBe(2);
    expect(loader?.unmatchedURDFRefs).toEqual([]);
    expect(loader?.debugMeshInfo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: "part.stl",
          found: true,
          urdfReference: "meshes/left/part.stl",
          webkitRelativePath: "workspace/robot/meshes/left/part.stl",
        }),
        expect.objectContaining({
          filename: "part.stl",
          found: true,
          urdfReference: "meshes/right/part.stl",
          webkitRelativePath: "workspace/robot/meshes/right/part.stl",
        }),
      ])
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("hydrates mesh and package assets into the currently loaded URDF without replacing its text", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;

    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    const urdf = `<?xml version="1.0"?>
<robot name="hydrated_assets_test">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://custom_description/meshes/base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`;

    const packageFile = createRelativeFile(
      "package.xml",
      `<?xml version="1.0"?><package><name>custom_description</name></package>`,
      "workspace/robot/package.xml",
      "application/xml"
    );
    const meshFile = createRelativeFile(
      "base.stl",
      "solid mesh",
      "workspace/robot/meshes/base.stl",
      "application/sla"
    );

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      loader?.loadUrdfText(urdf, {
        activePath: "workspace/robot/urdf/robot.urdf",
        filename: "robot.urdf",
      });
    });

    expect(loader?.unmatchedURDFRefs).toEqual(["package://custom_description/meshes/base.stl"]);
    expect(loader?.vizUrdfContent).toBe(urdf);

    let didHydrate = false;
    await act(async () => {
      didHydrate =
        (await loader?.hydrateLoadedAssetsFromFiles(
          [packageFile, meshFile] as unknown as FileList,
          {
            activePath: "workspace/robot/urdf/robot.urdf",
            urdfContent: urdf,
          }
        )) ?? false;
    });

    expect(didHydrate).toBe(true);
    expect(loader?.vizUrdfContent).toBe(urdf);
    expect(loader?.packageRoots).toEqual({
      custom_description: ["workspace/robot"],
      robot: ["workspace/robot"],
    });
    expect(loader?.unmatchedURDFRefs).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });

  it("preserves authored shared mesh references during repeated-link URDF load", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;
    const sourceUrdf = createRepeatedLinkMeshSourceUrdf();

    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      loader?.loadUrdfText(sourceUrdf, {
        filename: "repeated-link-meshes.urdf",
        activePath: "demo/repeated-link-meshes.urdf",
      });
    });

    expect(loader?.vizUrdfContent).toBe(sourceUrdf);
    expect(loader?.vizUrdfContent).toContain(`mesh filename="meshes/drive_motor_mount-v11.stl"`);
    expect(loader?.vizUrdfContent).toContain(`mesh filename="meshes/omni_wheel_mount-v5.stl"`);
    expect(loader?.vizUrdfContent).toContain(
      `mesh filename="meshes/4-Omni-Directional-Wheel_Single_Body-v1.stl"`
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("aliases repeated-link mesh references back to local shared mesh files", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;
    const sourceUrdf = createRepeatedLinkMeshSourceUrdf();

    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    const sharedMeshFiles = {
      "meshes/drive_motor_mount-v11.stl": new Blob(["solid a"]),
      "meshes/omni_wheel_mount-v5.stl": new Blob(["solid b"]),
      "meshes/4-Omni-Directional-Wheel_Single_Body-v1.stl": new Blob(["solid c"]),
    };

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      loader?.loadUrdfText(sourceUrdf, {
        filename: "repeated-link-meshes.urdf",
        activePath: "demo/repeated-link-meshes.urdf",
        meshFiles: sharedMeshFiles,
      });
    });

    expect(loader?.unmatchedURDFRefs).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });

  it("tracks repeated URDF loads separately from in-place URDF edits", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;

    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    const sourceUrdf = `<?xml version="1.0"?>
<robot name="reload_test">
  <link name="base_link" />
</robot>`;
    const editedUrdf = sourceUrdf.replace("/>", '><visual /></link>');

    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(loader?.urdfLoadRevision).toBe(0);

    await act(async () => {
      loader?.loadUrdfText(sourceUrdf, {
        filename: "reload_test.urdf",
        activePath: "demo/reload_test.urdf",
      });
    });

    const firstLoadRevision = loader?.urdfLoadRevision ?? 0;
    expect(firstLoadRevision).toBeGreaterThan(0);

    await act(async () => {
      loader?.updateUrdfFile(editedUrdf, "reload_test.urdf");
    });

    expect(loader?.urdfLoadRevision).toBe(firstLoadRevision);

    await act(async () => {
      loader?.loadUrdfText(sourceUrdf, {
        filename: "reload_test.urdf",
        activePath: "demo/reload_test.urdf",
      });
    });

    expect(loader?.urdfLoadRevision).toBeGreaterThan(firstLoadRevision);

    await act(async () => {
      root.unmount();
    });
  });

  it("tracks repeated folder loads even when the URDF content is unchanged", async () => {
    let loader: ReturnType<typeof useUrdfLoader> | null = null;

    const Harness = () => {
      loader = useUrdfLoader();
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    const sourceUrdf = `<?xml version="1.0"?>
<robot name="repeat_folder_load_test">
  <link name="base_link" />
</robot>`;
    const sourceFile = createRelativeFile(
      "repeat_folder_load_test.urdf",
      sourceUrdf,
      "demo/repeat_folder_load_test.urdf",
      "application/xml"
    );

    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(loader?.urdfLoadRevision).toBe(0);

    await act(async () => {
      await loader?.loadFilesFromFolder([sourceFile] as unknown as FileList);
    });

    const firstLoadRevision = loader?.urdfLoadRevision ?? 0;
    expect(firstLoadRevision).toBeGreaterThan(0);

    await act(async () => {
      await loader?.loadFilesFromFolder([sourceFile] as unknown as FileList);
    });

    expect(loader?.urdfLoadRevision).toBeGreaterThan(firstLoadRevision);

    await act(async () => {
      root.unmount();
    });
  });
});
