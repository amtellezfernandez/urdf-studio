import h5py 
# import mediapy
from glob import glob
import os
from tqdm import tqdm
import zarr

if __name__ == "__main__":
    root_dir = "/home/yujustin/xi/output_data/franka_coffee_maker/successes" # TODO: update this path
    h5_files = glob("**/*.h5", root_dir=root_dir, recursive=True)
    h5_files = [os.path.join(root_dir, h5_file) for h5_file in h5_files]
    
    # REAL DATA KEYS
    # action_key = "action/cartesian_pose"
    # proprio_key = "state/cartesian/cartesian_pose"
    # joint_key = "state/joint/joint_angle_rad"
    
    # SYNTHETIC DATA KEYS
    proprio_key = "ee_poses"
    joint_key = "joint_angles"
    gripper_binary_cmd_key = "gripper_binary_cmd"
    
    for h5_file in tqdm(h5_files):
        # output_action_path = h5_file.replace(".h5", "_action.zarr")
        output_proprio_path = h5_file.replace(".h5", "_proprio.zarr")
        output_joint_path = h5_file.replace(".h5", "_joint.zarr")
        output_gripper_path = h5_file.replace(".h5", "_gripper_cmd.zarr")
        with h5py.File(h5_file, "r") as f:
            # actions = f[action_key][:]
            proprio = f[proprio_key][:]
            joints = f[joint_key][:]
            gripper_binary_cmd = f[gripper_binary_cmd_key][:]
            # zarr.save_array(output_action_path, actions)
            zarr.save_array(output_proprio_path, proprio)
            zarr.save_array(output_joint_path, joints)
            zarr.save_array(output_gripper_path, gripper_binary_cmd)