import numpy as np
from scipy.spatial.transform import Rotation
import torch 
import math

def reorient_quaternion(quat_wxyz: np.ndarray) -> np.ndarray:
    """
    Convert quaternion to a new quaternion where:
    1. Original z-axis is projected onto x-y plane to form new y-axis
    2. New z-axis points in -z direction
    3. New x-axis is computed via Gram-Schmidt
    
    Args:
        quat_wxyz: Quaternion in wxyz format
        
    Returns:
        Quaternion in wxyz format representing the reoriented rotation
    """
    # Convert quaternion to rotation matrix
    # Note: scipy expects xyzw format, so we reorder
    R_original = Rotation.from_quat([quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0]]).as_matrix()
    
    # Get the original z-axis (third column of rotation matrix)
    z_original = R_original[:, 2]
    
    # Project z_original onto x-y plane by zeroing out z component
    y_new = np.array([z_original[0], z_original[1], 0.0])
    
    # If projection is too small, use original y-axis projection instead
    if np.linalg.norm(y_new) < 1e-6:
        y_original = R_original[:, 1]
        y_new = np.array([y_original[0], y_original[1], 0.0])
    
    # Normalize y_new
    y_new = y_new / np.linalg.norm(y_new)
    
    # Set z_new to point downward
    z_new = np.array([0.0, 0.0, -1.0])
    
    # Compute x_new using cross product to ensure right-handed system
    x_new = np.cross(y_new, z_new)
    x_new = x_new / np.linalg.norm(x_new)
    
    # Construct new rotation matrix
    R_new = np.column_stack([x_new, y_new, z_new])
    
    # Convert back to quaternion (scipy returns xyzw, we convert to wxyz)
    quat_new_xyzw = Rotation.from_matrix(R_new).as_quat()
    quat_new_wxyz = np.array([quat_new_xyzw[3], quat_new_xyzw[0], quat_new_xyzw[1], quat_new_xyzw[2]])
    
    return quat_new_wxyz


def reorient_quaternion_batch(quat_wxyz: np.ndarray) -> np.ndarray:
    """
    Convert batch of quaternions to new quaternions where for each:
    1. Original z-axis is projected onto x-y plane to form new y-axis
    2. New z-axis points in -z direction
    3. New x-axis is computed via Gram-Schmidt
    4. If the original z-axis is at all pointing in +X (dot > 0),
       rotate the commanded Z axis by 180 deg about Z.

    Args:
        quat_wxyz: Quaternions in wxyz format, shape (N, 4)

    Returns:
        Quaternions in wxyz format representing the reoriented rotations, shape (N, 4)
    """
    # Ensure input is numpy array with correct shape
    quat_wxyz = np.asarray(quat_wxyz)
    if len(quat_wxyz.shape) != 2 or quat_wxyz.shape[1] != 4:
        raise ValueError(f"Expected input shape (N, 4), got {quat_wxyz.shape}")
    
    # Convert to scipy format (xyzw) and get rotation matrices
    quat_xyzw = np.column_stack([quat_wxyz[:, 1:], quat_wxyz[:, 0]])
    R_originals = Rotation.from_quat(quat_xyzw).as_matrix()  # Shape: (N, 3, 3)
    
    # Get original z-axes (third column of each rotation matrix)
    z_originals = R_originals[..., 2]  # Shape: (N, 3)
    
    # Project onto x-y plane by zeroing out z component
    y_new = z_originals.copy()
    y_new[:, 2] = 0
    y_norms = np.linalg.norm(y_new, axis=1)
    
    # Handle small projection cases
    small_proj_mask = y_norms < 1e-6
    if np.any(small_proj_mask):
        y_originals = R_originals[small_proj_mask, :, 1]
        y_new[small_proj_mask] = y_originals
        y_new[small_proj_mask, 2] = 0
        y_norms[small_proj_mask] = np.linalg.norm(y_new[small_proj_mask], axis=1)
    
    # Normalize y_new
    y_new /= y_norms[:, np.newaxis]
    
    # New z-axis is same for all rotations
    z_new = np.array([0.0, 0.0, -1.0])
    z_new_batch = np.tile(z_new, (len(quat_wxyz), 1))
    
    # Compute x_new using cross product
    x_new = np.cross(y_new, z_new_batch, axis=1)
    x_norms = np.linalg.norm(x_new, axis=1)
    x_new /= x_norms[:, np.newaxis]
    
    # Construct new rotation matrices
    R_new = np.stack([x_new, y_new, z_new_batch], axis=2)  # (N, 3, 3)

    # ---------------------------------------------------------------------- #
    #  (A) Identify which z_originals are "at all" pointing in +Y: dot > 0    #
    # ---------------------------------------------------------------------- #
    world_y = np.array([0.0, 1.0, 0.0])
    dot_vals = np.einsum('ij,j->i', z_originals, world_y)
    flip_mask = (dot_vals > 0.0)  # If >0, z_original is within 90° of +Y

    # flip_mask = flip_mask & left_hand_envs
    # ---------------------------------------------------------------------- #
    #  (B) For those that meet the condition, rotate R_new by 180° about Z.   #
    # ---------------------------------------------------------------------- #
    if np.any(flip_mask):
        # Build a 180 deg rotation about Z
        rot_180_z = Rotation.from_rotvec([0, 0, np.pi]).as_matrix()  
        R_new[flip_mask] = R_new[flip_mask] @ rot_180_z

    # Convert back to quaternions
    quat_new_xyzw = Rotation.from_matrix(R_new).as_quat()
    quat_new_wxyz = np.column_stack([quat_new_xyzw[:, 3], 
                                     quat_new_xyzw[:, 0],
                                     quat_new_xyzw[:, 1], 
                                     quat_new_xyzw[:, 2]])
    
    return quat_new_wxyz


def quaternion_normalize(q):
    """Normalize a quaternion to unit length."""
    return q / q.norm(dim=-1, keepdim=True)

def quaternion_inverse(q):
    """Returns the inverse (i.e. conjugate for a unit quaternion) of q."""
    # q in wxyz format
    w, x, y, z = q.unbind(-1)
    # For a *unit* quaternion, inverse is just the conjugate
    return torch.stack([w, -x, -y, -z], dim=-1)

def quaternion_multiply(q1, q2):
    """
    Multiply two batches of quaternions.
    q1, q2: [..., 4] tensors in wxyz format.
    Returns: [..., 4] tensor in wxyz format.
    """
    w1, x1, y1, z1 = q1.unbind(-1)
    w2, x2, y2, z2 = q2.unbind(-1)

    w = w1*w2 - x1*x2 - y1*y2 - z1*z2
    x = w1*x2 + x1*w2 + y1*z2 - z1*y2
    y = w1*y2 - x1*z2 + y1*w2 + z1*x2
    z = w1*z2 + x1*y2 - y1*x2 + z1*w2

    return torch.stack([w, x, y, z], dim=-1)

def quaternion_dot(q1, q2):
    """Dot product of two quaternions (assuming wxyz format)."""
    return (q1 * q2).sum(dim=-1)

def slerp(q0, q1, alpha):
    """
    Spherical Linear Interpolation (SLERP) between two unit quaternions q0, q1.
    alpha is a scalar in [0, 1].
    Both q0 and q1 should be normalized.
    Returns: interpolated quaternion in wxyz format (also unit).
    """
    # Ensure q0, q1 are unit quaternions
    q0 = quaternion_normalize(q0)
    q1 = quaternion_normalize(q1)
    
    # Dot product
    dot = quaternion_dot(q0, q1)

    # If dot < 0, invert one quaternion to take the shortest path
    # (because q and -q represent the same orientation)
    mask = dot < 0.0
    if mask.any():
        q1[mask] = -q1[mask]
        dot[mask] = -dot[mask]

    # Clip dot to avoid numerical issues with acos
    dot = torch.clamp(dot, -1.0, 1.0)

    # If the quaternions are almost the same, do a linear interpolation
    # to avoid numerical instability of acos near 1.0
    eps = 1e-8
    close_mask = (1.0 - dot) < eps
    if close_mask.any():
        # Linear interpolation
        result = q0 * (1.0 - alpha) + q1 * alpha
        return quaternion_normalize(result)
    else:
        # Slerp
        theta_0 = torch.acos(dot)
        sin_theta_0 = torch.sin(theta_0)

        theta = theta_0 * alpha
        sin_theta = torch.sin(theta)

        s0 = torch.sin(theta_0 - theta) / (sin_theta_0 + eps)
        s1 = sin_theta / (sin_theta_0 + eps)

        result = (q0 * s0.unsqueeze(-1)) + (q1 * s1.unsqueeze(-1))
        return quaternion_normalize(result)
def slerp_with_clip(q0, q1, alpha, max_angle_rad):
    """
    Spherical Linear Interpolation (SLERP) between two unit quaternions q0, q1,
    with the maximum rotation angle clipped to max_angle_rad.
    
    Args:
        q0: Starting quaternion (wxyz format)
        q1: Ending quaternion (wxyz format)
        alpha: Interpolation parameter in [0, 1]
        max_angle_rad: Maximum allowed rotation angle in radians
    
    Returns:
        Interpolated quaternion (also unit, wxyz format)
    """
    # Ensure q0, q1 are unit quaternions
    q0 = quaternion_normalize(q0)
    q1 = quaternion_normalize(q1)
    
    # Dot product
    dot = quaternion_dot(q0, q1)

    # If dot < 0, invert one quaternion to take the shortest path
    mask = dot < 0.0
    if mask.any():
        q1[mask] = -q1[mask]
        dot[mask] = -dot[mask]

    # Clip dot to avoid numerical issues with acos
    dot = torch.clamp(dot, -1.0, 1.0)
    
    # Calculate the total rotation angle
    theta_0 = torch.acos(dot)
    
    # Clip the total rotation angle if it exceeds max_angle_rad
    max_angle = torch.full_like(theta_0, max_angle_rad)
    theta_0_clipped = torch.minimum(theta_0, max_angle)
    
    # If the quaternions are very close, do linear interpolation
    eps = 1e-8
    close_mask = (1.0 - dot) < eps
    if close_mask.any():
        # Linear interpolation
        result = q0 * (1.0 - alpha) + q1 * alpha
        return quaternion_normalize(result)
    else:
        # Modified slerp with clipped angle
        theta = theta_0_clipped * alpha
        sin_theta_0 = torch.sin(theta_0_clipped)
        sin_theta = torch.sin(theta)

        s0 = torch.sin(theta_0_clipped - theta) / (sin_theta_0 + eps)
        s1 = sin_theta / (sin_theta_0 + eps)

        result = (q0 * s0.unsqueeze(-1)) + (q1 * s1.unsqueeze(-1))
        return quaternion_normalize(result)

def wrap_to_pi(angles):
    """
    angles: Tensor of Euler angles, in radians
    Returns: angles wrapped into the range [-pi, pi].
    """
    # wrap values above pi
    angles = torch.where(angles > math.pi, angles - 2*math.pi, angles)
    # wrap values below -pi
    angles = torch.where(angles <= -math.pi, angles + 2*math.pi, angles)
    return angles