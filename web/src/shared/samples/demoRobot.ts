export const DEMO_ROBOT_URDF = `<?xml version="1.0"?>
<robot name="urdf_studio_demo">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <box size="0.22 0.22 0.08" />
      </geometry>
      <material name="base_color">
        <color rgba="0.2 0.6 0.9 1" />
      </material>
    </visual>
  </link>

  <link name="link_1">
    <visual>
      <origin xyz="0 0 0.15" rpy="0 0 0" />
      <geometry>
        <cylinder radius="0.04" length="0.3" />
      </geometry>
      <material name="link_color">
        <color rgba="0.8 0.4 0.2 1" />
      </material>
    </visual>
  </link>

  <joint name="joint_1" type="revolute">
    <parent link="base_link" />
    <child link="link_1" />
    <origin xyz="0 0 0.05" rpy="0 0 0" />
    <axis xyz="0 1 0" />
    <limit lower="-1.57" upper="1.57" effort="1" velocity="1" />
  </joint>

  <link name="link_2">
    <visual>
      <origin xyz="0 0 0.15" rpy="0 0 0" />
      <geometry>
        <box size="0.08 0.08 0.3" />
      </geometry>
      <material name="tip_color">
        <color rgba="0.9 0.9 0.2 1" />
      </material>
    </visual>
  </link>

  <joint name="joint_2" type="revolute">
    <parent link="link_1" />
    <child link="link_2" />
    <origin xyz="0 0 0.3" rpy="0 0 0" />
    <axis xyz="1 0 0" />
    <limit lower="-1.57" upper="1.57" effort="1" velocity="1" />
  </joint>
</robot>
`;
