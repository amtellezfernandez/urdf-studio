# python script/visualize_dataset_randomization.py --root-dir /home/yujustin/dataset/dp_gs/sim_coffee_maker/successes_033125_1619
"""
root_dir
    - env_15_2025_03_31_15_15_00
        - camera_0
            - rgb 
                - 0000.jpg
        - camera_1
        - robot_data

Create a visualization script that will take in the root_dir and 
combines first image from each trajectory with name env_* into a video at 30fps so that we can see the randomization
"""

import os
import glob
import cv2
import tyro
import numpy as np
from dataclasses import dataclass
from typing import Optional, List
from tqdm import tqdm
import random  # Added for sampling trajectories


@dataclass
class VisualizationArgs:
    """Arguments for dataset randomization visualization."""
    
    root_dir: str
    """Path to the root directory containing environment trajectories."""
    
    output_dir: str = "visualization_output"
    """Directory to save the output visualizations."""
    
    output_path: str = "randomization_visualization.mp4"
    """Filename for the output randomization video (relative to output_dir)."""
    
    fps: int = 30
    """Frames per second for the output video."""
    
    camera_id: int = 0
    """Camera ID to use for visualization (e.g., 0 for camera_0)."""

    first_n_traj: Optional[int] = None # Made Optional for clarity
    """Number of trajectories to process for the main randomization video/image."""
    
    create_stacked_image: bool = False
    """Whether to create a stacked image visualization of all first frames."""
    
    stacked_image_path: str = "stacked_visualization.jpg"
    """Filename for the stacked image visualization (relative to output_dir)."""
    
    stacked_alpha: float = 0.1
    """Alpha value for blending images in the stacked visualization (0.0-1.0). Only used if std dev calculation fails."""
    
    stacked_contrast: float = 1.0 # Default contrast to 1 (no change)
    """Contrast enhancement factor for the stacked image (higher values increase contrast)."""
    
    stacked_brightness: float = 0.0
    """Brightness adjustment for the stacked image (-1.0 to 1.0)."""
    
    num_traj_videos: int = 3
    """Number of full trajectories to sample and create videos for."""
    
    resize_videos: bool = False
    """Whether to resize frames (halve dimensions) for all output videos."""


def create_video(
    output_path: str, 
    frames: List[np.ndarray], 
    fps: int, 
    resize: bool = True
) -> None:
    """Creates a video from a list of frames.

    Args:
        output_path (str): Path to save the output video.
        frames (List[np.ndarray]): List of image frames (BGR, uint8).
        fps (int): Frames per second for the output video.
        resize (bool): Whether to resize frames (halve dimensions).
    """
    if not frames:
        print(f"No frames provided for video: {output_path}")
        return

    height, width = frames[0].shape[:2]
    if resize:
        new_width, new_height = width // 2, height // 2
    else:
        new_width, new_height = width, height

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    video_writer = cv2.VideoWriter(
        output_path,
        fourcc,
        fps,
        (new_width, new_height),
        isColor=True
    )

    for img in tqdm(frames, desc=f"Writing video {os.path.basename(output_path)}", leave=False):
        if resize:
            processed_img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
        else:
            processed_img = img
        video_writer.write(processed_img)

    video_writer.release()
    print(f"Video saved to {output_path}")


def main(args: VisualizationArgs) -> None:
    """Create visualizations for dataset randomization."""
    
    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)
    print(f"Saving outputs to: {args.output_dir}")

    # --- Process First Frames for Randomization Video/Image ---
    
    # Find all environment directories
    env_dirs = sorted(glob.glob(os.path.join(args.root_dir, "env_*")))
    
    if not env_dirs:
        print(f"No environment directories found in {args.root_dir}")
        return
    
    # Select subset if needed
    num_to_process = args.first_n_traj if args.first_n_traj is not None else len(env_dirs)
    env_dirs_to_process = env_dirs[:num_to_process]

    # Collect first images
    first_images = []
    valid_env_dirs_for_first = [] # Keep track of dirs with valid first images
    for env_dir in tqdm(env_dirs_to_process, desc="Processing environments (first frames)"):
        rgb_dir = os.path.join(env_dir, f"camera_{args.camera_id}", "rgb")
        if not os.path.exists(rgb_dir):
            # print(f"RGB directory not found in {env_dir}") # Reduce noise
            continue
            
        image_files = sorted(glob.glob(os.path.join(rgb_dir, "*.jpg")))
        if not image_files:
            # print(f"No images found in {rgb_dir}") # Reduce noise
            continue
            
        img = cv2.imread(image_files[0])
        if img is not None:
            first_images.append(img)
            valid_env_dirs_for_first.append(env_dir)
        else:
            print(f"Failed to read image: {image_files[0]}")
    
    if not first_images:
        print("No valid first images found for randomization video/image.")
    else:
        # Create randomization video (from first frames)
        randomization_video_path = os.path.join(args.output_dir, args.output_path)
        create_video(randomization_video_path, first_images, args.fps, resize=args.resize_videos)
        
        # Create stacked image visualization if requested
        if args.create_stacked_image:
            print("Creating stacked image visualization (standard deviation)...")
            stacked_image_save_path = os.path.join(args.output_dir, args.stacked_image_path)
            
            # Convert images to float32 for calculation, stack them
            images_np = np.array(first_images, dtype=np.float32)
            
            # Calculate the standard deviation
            print("Calculating standard deviation image...")
            stacked_img_float = np.std(images_np, axis=0)
            
            # Normalize the standard deviation image to 0-255 range
            min_val, max_val = np.min(stacked_img_float), np.max(stacked_img_float)
            if max_val > min_val:
                stacked_img_normalized = ((stacked_img_float - min_val) / (max_val - min_val)) * 255.0
            else:
                stacked_img_normalized = np.zeros_like(stacked_img_float)

            # Convert back to uint8
            stacked_img = stacked_img_normalized.astype(np.uint8)

            # Optional contrast/brightness (usually not needed for std dev)
            # stacked_img = cv2.convertScaleAbs(stacked_img, alpha=args.stacked_contrast, beta=args.stacked_brightness * 255)
            
            # Apply CLAHE
            print("Applying CLAHE...")
            if len(stacked_img.shape) == 3 and stacked_img.shape[2] == 3:
                 clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
                 lab = cv2.cvtColor(stacked_img, cv2.COLOR_BGR2LAB)
                 lab[:,:,0] = clahe.apply(lab[:,:,0])
                 stacked_img = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
            
            # Save the stacked image
            cv2.imwrite(stacked_image_save_path, stacked_img)
            print(f"Stacked image saved to {stacked_image_save_path}")

    # --- Process Full Trajectories for Sampled Videos ---

    if args.num_traj_videos > 0 and env_dirs:
        num_to_sample = min(args.num_traj_videos, len(env_dirs))
        sampled_env_dirs = random.sample(env_dirs, num_to_sample)
        print(f"Sampling {num_to_sample} trajectories for full video visualization...")

        for i, env_dir in enumerate(tqdm(sampled_env_dirs, desc="Generating trajectory videos")):
            rgb_dir = os.path.join(env_dir, f"camera_{args.camera_id}", "rgb")
            if not os.path.exists(rgb_dir):
                print(f"Skipping trajectory video: RGB directory not found in {env_dir}")
                continue
                
            image_files = sorted(glob.glob(os.path.join(rgb_dir, "*.jpg")))
            if not image_files:
                print(f"Skipping trajectory video: No images found in {rgb_dir}")
                continue
            
            # Read all frames for the trajectory
            traj_frames = []
            for img_file in tqdm(image_files, desc=f"Reading frames for {os.path.basename(env_dir)}", leave=False):
                img = cv2.imread(img_file)
                if img is not None:
                    traj_frames.append(img)
                else:
                    print(f"Warning: Failed to read image {img_file}")

            if traj_frames:
                # Create video for this trajectory
                traj_video_filename = f"trajectory_{os.path.basename(env_dir)}.mp4"
                traj_video_path = os.path.join(args.output_dir, traj_video_filename)
                create_video(traj_video_path, traj_frames, args.fps, resize=args.resize_videos)
            else:
                 print(f"Skipping trajectory video: No valid frames found for {os.path.basename(env_dir)}")

    print("Visualization script finished.")


if __name__ == "__main__":
    main(tyro.cli(VisualizationArgs))