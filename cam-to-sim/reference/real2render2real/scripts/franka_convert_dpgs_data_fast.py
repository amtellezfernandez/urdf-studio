from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from PIL import Image
from tqdm import tqdm
from typing import List
import ffmpeg
import json
import multiprocessing
import numpy as np
import os
import pandas as pd
import shutil
import tyro
import zarr

def convert_to_uint8(img: np.ndarray) -> np.ndarray:
    """Converts an image to uint8 if it is a float image.

    This is important for reducing the size of the image when sending it over the network.
    """
    if np.issubdtype(img.dtype, np.floating):
        img = (255 * img).astype(np.uint8)
    return img


def resize_with_pad(images: np.ndarray, height: int, width: int, method=Image.BILINEAR) -> np.ndarray:
    """Replicates tf.image.resize_with_pad for multiple images using PIL. Resizes a batch of images to a target height.

    Args:
        images: A batch of images in [..., height, width, channel] format.
        height: The target height of the image.
        width: The target width of the image.
        method: The interpolation method to use. Default is bilinear.

    Returns:
        The resized images in [..., height, width, channel].
    """
    # If the images are already the correct size, return them as is.
    if images.shape[-3:-1] == (height, width):
        return images

    original_shape = images.shape

    images = images.reshape(-1, *original_shape[-3:])
    resized = np.stack([_resize_with_pad_pil(Image.fromarray(im), height, width, method=method) for im in images])
    return resized.reshape(*original_shape[:-3], *resized.shape[-3:])


def _resize_with_pad_pil(image: Image.Image, height: int, width: int, method: int) -> Image.Image:
    """Replicates tf.image.resize_with_pad for one image using PIL. Resizes an image to a target height and
    width without distortion by padding with zeros.

    Unlike the jax version, note that PIL uses [width, height, channel] ordering instead of [batch, h, w, c].
    """
    cur_width, cur_height = image.size
    if cur_width == width and cur_height == height:
        return image  # No need to resize if the image is already the correct size.

    ratio = max(cur_width / width, cur_height / height)
    resized_height = int(cur_height / ratio)
    resized_width = int(cur_width / ratio)
    resized_image = image.resize((resized_width, resized_height), resample=method)

    zero_image = Image.new(resized_image.mode, (width, height), 0)
    pad_height = max(0, int((height - resized_height) / 2))
    pad_width = max(0, int((width - resized_width) / 2))
    zero_image.paste(resized_image, (pad_width, pad_height))
    assert zero_image.size == (width, height)
    return zero_image

@dataclass
class Config:
    raw_dataset_folders: List[str] = field(default_factory=lambda: ["/home/yujustin/xi/output_data/franka_coffee_maker/successes"])
    language_instructions: List[str] = field(default_factory=lambda: ["put the white cup on the coffee machine"])
    output_dir: Path = field(default_factory=lambda: Path("/home/yujustin/xi/output_data/franka_coffee_maker/dpgs_sim_franka_coffee_maker_1k_fast_043025_0207"))
    camera_keys: List[str] = field(default_factory=lambda: ["camera_0/rgb", "camera_1/rgb"])
    camera_key_outputs: List[str] = field(default_factory=lambda: ["exterior_image_1_left", "exterior_image_2_left"])
    state_key: str = "robot_data/robot_data_joint.zarr"
    resize_size: int = 224
    action_dim: int = 8
    fps: int = 15
    chunk_size: int = 1000
    max_workers: int = multiprocessing.cpu_count()

    @property
    def camera_key_mapping(self):
        return dict(zip(self.camera_keys, self.camera_key_outputs))

def encode_video(frames: List[np.ndarray], save_path: Path, fps: int):
    """Encode frames into a video using ffmpeg-python and libx264 for faster encoding."""
    height, width, _ = frames[0].shape
    (
        ffmpeg
        .input('pipe:', format='rawvideo', pix_fmt='rgb24', s=f'{width}x{height}', framerate=fps)
        .output(
            str(save_path),
            vcodec='libx264',           # <--- use libx264 (h264 encoder)
            crf=23,                     # quality: lower = better, typical range 18-28
            preset='ultrafast',          # speed: slower preset = better compression, 'ultrafast' is fastest
            pix_fmt='yuv420p',           # ensure compatibility
            r=fps
        )
        .overwrite_output()
        .run(
            input=np.stack(frames).astype(np.uint8).tobytes(),
            capture_stdout=True,
            capture_stderr=True
        )
    )

def process_episode(
    idx: int, task_folder: str, language_instruction: str, cfg: Config, episode_base: Path
):
    proprio_data = zarr.load(os.path.join(task_folder, cfg.state_key))
    if proprio_data is None:
        print(f"No proprio data found for {task_folder}")
    seq_length = proprio_data.shape[0] - 1

    images = {
        key: sorted(os.listdir(os.path.join(task_folder, key)))
        for key in cfg.camera_keys
    }

    image_data = {
        key: [
            resize_with_pad(
                np.array(Image.open(os.path.join(task_folder, key, img))),
                cfg.resize_size,
                cfg.resize_size
            )
            for img in imgs
        ]
        for key, imgs in images.items()
    }

    # Save parquet (joint positions + actions per frame)
    # scaling gripper to the 0 open, 1 close for FRANKA
    proprio_data[:, -1:] = (0.04 - proprio_data[:, -1:]) / 0.04
    
    records = []
    for step in range(seq_length):
        proprio_t = proprio_data[step]
        action_t = proprio_data[step + 1] - proprio_t
        
        # action_t[-2:] = proprio_data[step + 1][-2:]  # absolute gripper # YUMI SPECIFIC
        action_t[-1:] = proprio_data[step + 1][-1:]  # absolute gripper # FRANKA SPECIFIC
        # action_t[-1:] = (0.04 - proprio_data[step + 1][-1:]) / 0.04  # absolute gripper # FRANKA SPECIFIC
        
        record = {
            "joint_position": proprio_t.tolist(),
            "actions": action_t.tolist(),
            "timestamp": [0.0],
            "frame_index": [step],
            "episode_index": [idx],
            "index": [step],
            "task_index": [0],
        }
        records.append(record)

    episode_path = episode_base / f"episode_{idx:06d}.parquet"
    pd.DataFrame(records).to_parquet(episode_path)

    # Save videos
    chunk_id = idx // cfg.chunk_size
    for cam_key, mapped_key in cfg.camera_key_mapping.items():
        video_dir = cfg.output_dir / "videos" / f"chunk-{chunk_id:03d}" / mapped_key
        video_dir.mkdir(parents=True, exist_ok=True)
        save_path = video_dir / f"episode_{idx:06d}.mp4"
        frames = image_data[cam_key][:seq_length]
        encode_video(frames, save_path, cfg.fps)

    # Return metadata for episode
    return {
        "episode_index": idx,
        "tasks": [language_instruction],
        "length": seq_length,
    }

def main(cfg: Config):
    # Prepare folders
    base_dir = cfg.output_dir
    (base_dir / "data").mkdir(parents=True, exist_ok=True)
    (base_dir / "meta").mkdir(exist_ok=True)
    (base_dir / "videos").mkdir(exist_ok=True)

    all_episodes = []
    idx_counter = 0

    # Write tasks.jsonl
    tasks_jsonl = [{"task_index": idx, "task": task} for idx, task in enumerate(cfg.language_instructions)]
    with open(base_dir / "meta" / "tasks.jsonl", "w") as f:
        for t in tasks_jsonl:
            f.write(json.dumps(t) + "\n")

    # Collect all episodes
    episode_tuples = []
    for folder, instruction in zip(cfg.raw_dataset_folders, cfg.language_instructions):
        trajs = sorted(os.listdir(folder))
        for traj in trajs:
            episode_tuples.append((idx_counter, os.path.join(folder, traj), instruction))
            idx_counter += 1

    episode_base = base_dir / "data"
    for i in range((idx_counter + cfg.chunk_size - 1) // cfg.chunk_size):
        (episode_base / f"chunk-{i:03d}").mkdir(parents=True, exist_ok=True)

    with ProcessPoolExecutor(max_workers=cfg.max_workers) as executor:
        futures = []
        for idx, traj_path, instruction in episode_tuples:
            futures.append(
                executor.submit(process_episode, idx, traj_path, instruction, cfg, episode_base / f"chunk-{idx // cfg.chunk_size:03d}")
            )
        for f in tqdm(futures, desc="Processing episodes"):
            all_episodes.append(f.result())

    # Write episodes.jsonl
    with open(base_dir / "meta" / "episodes.jsonl", "w") as f:
        for epi in all_episodes:
            f.write(json.dumps(epi) + "\n")

    # Write info.json
    info = {
        "codebase_version": "v2.0",
        "robot_type": "yumi",
        "total_episodes": idx_counter,
        "total_frames": sum(e["length"] for e in all_episodes),
        "total_tasks": len(cfg.language_instructions),
        "total_videos": len(cfg.camera_keys) * idx_counter,
        "total_chunks": (idx_counter + cfg.chunk_size - 1) // cfg.chunk_size,
        "chunks_size": cfg.chunk_size,
        "fps": cfg.fps,
        "splits": {"train": f"0:{idx_counter}"},
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
        "video_path": "videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4",
        "features": {
            **{
                output_key: {
                    "dtype": "video",
                    "shape": [cfg.resize_size, cfg.resize_size, 3],
                    "names": ["height", "width", "channel"],
                    "info": {
                        "video.fps": cfg.fps,
                        "video.height": cfg.resize_size,
                        "video.width": cfg.resize_size,
                        "video.channels": 3,
                        "video.codec": "av1",
                        "video.pix_fmt": "yuv420p",
                        "video.is_depth_map": False,
                        "has_audio": False
                    }
                }
                for output_key in cfg.camera_key_outputs
            },
            "joint_position": {
                "dtype": "float32",
                "shape": [cfg.action_dim],
                "names": ["joint_position"],
            },
            "actions": {
                "dtype": "float32",
                "shape": [cfg.action_dim],
                "names": ["actions"],
            },
            "timestamp": {"dtype": "float32", "shape": [1], "names": None},
            "frame_index": {"dtype": "int64", "shape": [1], "names": None},
            "episode_index": {"dtype": "int64", "shape": [1], "names": None},
            "index": {"dtype": "int64", "shape": [1], "names": None},
            "task_index": {"dtype": "int64", "shape": [1], "names": None},
        }
    }
    with open(base_dir / "meta" / "info.json", "w") as f:
        json.dump(info, f, indent=2)

if __name__ == "__main__":
    cfg = tyro.cli(Config)
    main(cfg)