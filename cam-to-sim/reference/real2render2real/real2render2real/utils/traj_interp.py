import numpy as np
from scipy.spatial.transform import Rotation as R
from typing import Tuple

def traj_interp(
    traj : np.ndarray, # (T, xyzwxyz), T is the number of waypoints
    new_start : np.ndarray, # (xyzwxyz)
    new_end : np.ndarray, # (xyzwxyz)
    interp_mode : str = 'linear', # 'linear' or 'slerp'
    interp_dof_masks : np.ndarray = np.array([1, 1, 1, 1, 1, 1]), # (xyzwxyz)
) -> np.ndarray: # (T, xyzwxyz)
    """
    Interpolate a trajectory from the given start to end waypoints.
    traj: (T, xyzwxyz), T is the number of waypoints, describes how object moves in the world frame in the demonstration 
    new_start: (xyzwxyz), the start waypoint of the new trajectory
    new_end: (xyzwxyz), the end waypoint of the new trajectory
    """
    T = len(traj)
    new_traj = np.zeros_like(traj)
    
    # Normalize time steps
    t = np.linspace(0, 1, T)
    
    # Split into position and rotation components
    pos_orig = traj[:, :3]
    quat_orig = traj[:, 3:7]
    
    pos_start = new_start[:3]
    pos_end = new_end[:3]
    quat_start = new_start[3:7]
    quat_end = new_end[3:7]
    
    # Apply masks
    pos_mask = interp_dof_masks[:3]
    rot_mask = interp_dof_masks[3:6]
    
    # Interpolate positions
    for i, mask in enumerate(pos_mask):
        if mask:
            new_traj[:, i] = pos_start[i] + (pos_end[i] - pos_start[i]) * (traj[:, i] - traj[0, i]) / (traj[-1, i] - traj[0, i] + 1e-10)
        else:
            new_traj[:, i] = traj[:, i]
    
    # Interpolate rotations
    if interp_mode == 'linear':
        for i in range(T):
            if any(rot_mask):
                new_traj[i, 3:7] = (1 - t[i]) * quat_start + t[i] * quat_end
                new_traj[i, 3:7] /= np.linalg.norm(new_traj[i, 3:7])
            else:
                new_traj[i, 3:7] = quat_orig[i]
    else:  # slerp
        for i in range(T):
            if any(rot_mask):
                r_start = R.from_quat(quat_start)
                r_end = R.from_quat(quat_end)
                r_interp = r_start.slerp(r_end, t[i])
                new_traj[i, 3:7] = r_interp.as_quat()
            else:
                new_traj[i, 3:7] = quat_orig[i]
    
    return new_traj

def get_new_end(
    traj : np.ndarray, # (T, xyzwxyz), T is the number of waypoints
    demo_objects_start_poses : np.ndarray, # (N, xyzwxyz), N is the number of objects
    demo_objects_end_poses : np.ndarray, # (N, xyzwxyz), N is the number of objects
    new_objects_start_poses : np.ndarray, # (N, xyzwxyz), N is the number of objects
) -> np.ndarray:  # (xyzwxyz)
    """
    Get the end waypoint of the new trajectory

    The first pose in the trajectory correspond to one start pose of the object in demo_objects_start_poses, which is the object of interest 
    The new last pose should preserve the geometric configuration of the object of interest in the end pose of the demonstration. 
    We ignore the rotation of the object for now.
    """
    N = len(demo_objects_start_poses)
    new_end = np.zeros(7)  # xyzwxyz
    
    # Find which object corresponds to the trajectory
    # Compare the first pose of trajectory with demo start poses
    distances = np.linalg.norm(demo_objects_start_poses[:, :3] - traj[0, :3], axis=1)
    traj_obj_idx = np.argmin(distances)
    
    if N == 1:
        # For single object, preserve absolute distance from start to end
        delta = demo_objects_end_poses[0, :3] - demo_objects_start_poses[0, :3]
        new_end[:3] = new_objects_start_poses[0, :3] + delta
    else:
        # For multiple objects, preserve relative scaling for each axis
        for axis in range(3):
            # Calculate relative positions in the demonstration
            demo_rel_pos_start = demo_objects_start_poses[traj_obj_idx, axis] - demo_objects_start_poses[:, axis]
            demo_rel_pos_end = demo_objects_end_poses[traj_obj_idx, axis] - demo_objects_end_poses[:, axis]
            
            # Calculate scaling factors
            scale_factors = demo_rel_pos_end / (demo_rel_pos_start + 1e-10)  # Avoid division by zero
            
            # Apply median scaling to new position
            median_scale = np.median(scale_factors)
            new_rel_pos = new_objects_start_poses[traj_obj_idx, axis] - new_objects_start_poses[:, axis]
            new_end[axis] = np.mean(new_objects_start_poses[:, axis] + median_scale * new_rel_pos)
    
    # Copy the final rotation from the demonstration
    new_end[3:7] = demo_objects_end_poses[traj_obj_idx, 3:7]
    
    return new_end

def get_key_frames(
    traj : np.ndarray, # (T, xyzwxyz), T is the number of waypoints
    vel_thresh : float = 0.9,
) -> np.ndarray:  # (K, xyzwxyz), K is the number of key frames 
    """
    A key frame is defined by a series of poses where the velocity of the object is slower than 90% of the rest of the trajectory
    """
    # Calculate velocities (using position only)
    velocities = np.linalg.norm(np.diff(traj[:, :3], axis=0), axis=1)
    
    # Calculate 90th percentile threshold
    thresh = np.percentile(velocities, vel_thresh * 100)
    
    # Find frames where velocity is below threshold
    # We need to handle the first and last frame specially since diff reduces length by 1
    slow_frames = np.where(velocities < thresh)[0]
    key_frames = np.unique(np.concatenate([[0], slow_frames, slow_frames + 1, [len(traj) - 1]]))
    
    return traj[key_frames]