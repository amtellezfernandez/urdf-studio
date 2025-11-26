#!/usr/bin/env python3
"""
Rerun Viewer Service for URDF Studio
Visualizes episodes using Rerun Python SDK
"""

import json
import sys
import argparse
import xml.etree.ElementTree as ET
from typing import Dict, List, Tuple, Optional
import math

try:
    import rerun as rr
except ImportError:
    print("ERROR: rerun-sdk is not installed. Run: pip install rerun-sdk", file=sys.stderr)
    sys.exit(1)


def parse_urdf(urdf_content: str) -> Tuple[List[Dict], List[Dict]]:
    """Parse URDF and extract links and joints."""
    try:
        root = ET.fromstring(urdf_content)
    except ET.ParseError as e:
        print(f"ERROR: Failed to parse URDF: {e}", file=sys.stderr)
        return [], []
    
    links = []
    joints = []
    
    # Parse links
    for link in root.findall("link"):
        name = link.get("name")
        if name:
            links.append({"name": name})
    
    # Parse joints
    for joint in root.findall("joint"):
        name = joint.get("name")
        joint_type = joint.get("type", "fixed")
        
        parent_elem = joint.find("parent")
        child_elem = joint.find("child")

        if not name or parent_elem is None or child_elem is None:
            continue
        
        parent_link = parent_elem.get("link")
        child_link = child_elem.get("link")
        
        if not parent_link or not child_link:
            continue
        
        # Parse axis
        axis_elem = joint.find("axis")
        axis = [0.0, 0.0, 1.0]
        if axis_elem is not None:
            xyz = axis_elem.get("xyz", "0 0 1").split()
            if len(xyz) >= 3:
                axis = [float(xyz[0]), float(xyz[1]), float(xyz[2])]
        
        # Parse origin
        origin_elem = joint.find("origin")
        origin_xyz = [0.0, 0.0, 0.0]
        origin_rpy = [0.0, 0.0, 0.0]
        if origin_elem is not None:
            xyz_str = origin_elem.get("xyz", "0 0 0")
            rpy_str = origin_elem.get("rpy", "0 0 0")
            xyz_vals = xyz_str.split()
            rpy_vals = rpy_str.split()
            if len(xyz_vals) >= 3:
                origin_xyz = [float(xyz_vals[0]), float(xyz_vals[1]), float(xyz_vals[2])]
            if len(rpy_vals) >= 3:
                origin_rpy = [float(rpy_vals[0]), float(rpy_vals[1]), float(rpy_vals[2])]
        
        joints.append({
            "name": name,
            "type": joint_type,
            "parent_link": parent_link,
            "child_link": child_link,
            "axis": axis,
            "origin_xyz": origin_xyz,
            "origin_rpy": origin_rpy,
        })
    
    return links, joints


def euler_to_quaternion(rpy: List[float]) -> Tuple[float, float, float, float]:
    """Convert Euler angles (roll, pitch, yaw) to quaternion."""
    roll, pitch, yaw = rpy
    
    cy = math.cos(yaw * 0.5)
    sy = math.sin(yaw * 0.5)
    cp = math.cos(pitch * 0.5)
    sp = math.sin(pitch * 0.5)
    cr = math.cos(roll * 0.5)
    sr = math.sin(roll * 0.5)
    
    w = cr * cp * cy + sr * sp * sy
    x = sr * cp * cy - cr * sp * sy
    y = cr * sp * cy + sr * cp * sy
    z = cr * cp * sy - sr * sp * cy
    
    return (x, y, z, w)


def axis_angle_to_quaternion(axis: List[float], angle: float) -> Tuple[float, float, float, float]:
    """Convert axis-angle to quaternion."""
    half_angle = angle * 0.5
    s = math.sin(half_angle)
    c = math.cos(half_angle)
    
    # Normalize axis
    axis_len = math.sqrt(axis[0]**2 + axis[1]**2 + axis[2]**2)
    if axis_len > 0:
        axis = [axis[0] / axis_len, axis[1] / axis_len, axis[2] / axis_len]
    
    return (axis[0] * s, axis[1] * s, axis[2] * s, c)


def visualize_episode(
    episode_data: Dict,
    urdf_content: str,
    recording_name: str = "lerobot/episode",
    spawn: bool = True,
    serve: bool = False,
    web_port: int = 9090,
    ws_port: int = 9876,
):
    """Visualize an episode using Rerun."""
    
    # Parse URDF
    links, joints = parse_urdf(urdf_content)
    
    if not links or not joints:
        print("WARNING: No links or joints found in URDF", file=sys.stderr)
    
    # Initialize Rerun for visualization (not recording new data)
    if serve:
        print(f"Starting Rerun server on web_port={web_port}, grpc_port={ws_port}...")
        rr.init(recording_name, spawn=False)
        # Use the new API: serve_grpc + serve_web_viewer
        server_uri = rr.serve_grpc(grpc_port=ws_port)
        print(f"gRPC server running at: {server_uri}")
        rr.serve_web_viewer(web_port=web_port, open_browser=False, connect_to=server_uri)
    else:
        print(f"Visualizing episode {episode_data.get('number', 'unknown')} (displaying uploaded data, not recording)...")
        # Initialize Rerun to visualize the episode data
        rr.init(recording_name, spawn=spawn)
    
    # Log robot structure
    print(f"Logging robot structure: {len(links)} links, {len(joints)} joints")
    
    # Build link hierarchy map
    link_map = {link["name"]: link for link in links}
    joint_map = {joint["name"]: joint for joint in joints}
    
    # Find root link (link with no parent joint)
    child_links = {j["child_link"] for j in joints}
    root_links = [link["name"] for link in links if link["name"] not in child_links]
    root_link = root_links[0] if root_links else links[0]["name"] if links else "base_link"
    
    # Log transforms for each frame
    frames = episode_data.get("frames", [])
    if not frames:
        print("ERROR: No frames in episode data", file=sys.stderr)
        return
    
    print(f"Logging {len(frames)} frames...")
    
    for frame_idx, frame in enumerate(frames):
        timestamp = frame.get("timestamp", frame_idx * 0.033)  # Default 30fps
        joint_positions = frame.get("jointPositions", {})
        
        # Set time for this frame (timestamp is in milliseconds, convert to seconds)
        rr.set_time("timestamp", timestamp=timestamp / 1000.0)
        
        # Calculate transforms for each link
        link_transforms = {root_link: {"translation": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0, 1.0]}}
        
        # Process joints in hierarchy order (simplified - would need proper topological sort)
        processed_links = {root_link}
        
        for joint in joints:
            if joint["parent_link"] in processed_links:
                parent_transform = link_transforms[joint["parent_link"]]
                joint_value = joint_positions.get(joint["name"], 0.0)
                
                # Calculate child transform based on joint type
                translation = list(joint["origin_xyz"])
                rotation = euler_to_quaternion(joint["origin_rpy"])
                
                if joint["type"] in ["revolute", "continuous"]:
                    # Apply rotation around axis
                    axis_rot = axis_angle_to_quaternion(joint["axis"], joint_value)
                    # Combine rotations (simplified - should use quaternion multiplication)
                    rotation = axis_rot
                elif joint["type"] == "prismatic":
                    # Apply translation along axis
                    axis = joint["axis"]
                    translation = [
                        translation[0] + axis[0] * joint_value,
                        translation[1] + axis[1] * joint_value,
                        translation[2] + axis[2] * joint_value,
                    ]
                
                # Combine with parent transform (simplified)
                child_translation = [
                    parent_transform["translation"][0] + translation[0],
                    parent_transform["translation"][1] + translation[1],
                    parent_transform["translation"][2] + translation[2],
                ]
                
                link_transforms[joint["child_link"]] = {
                    "translation": child_translation,
                    "rotation": rotation,
                }
                processed_links.add(joint["child_link"])
        
        # Log transforms for each link
        for link_name, transform in link_transforms.items():
            path = f"robot/{link_name}"
            rr.log(
                path,
                rr.Transform3D(
                    translation=transform["translation"],
                    rotation=rr.Quaternion(xyzw=transform["rotation"]),
                ),
            )
            
            # Log a simple box to visualize the link (optional)
            # rr.log(path + "/box", rr.Boxes3D(centers=[[0, 0, 0]], half_sizes=[[0.1, 0.1, 0.1]]))
    
    print("Episode visualization complete!")
    print(f"Displaying episode data in viewer (not recording new data)")
    
    if serve:
        print(f"Web viewer: http://127.0.0.1:{web_port}")
        print("Press Ctrl+C to stop the server")
        # Keep the script running so the servers stay alive
        try:
            import time
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down Rerun servers...")
    else:
        # For spawn mode, keep the process alive so the viewer can stay open
        # The viewer needs the process to stay running to maintain the connection
        print("Rerun viewer should be open displaying your episode data.")
        print("Note: This process will stay running while the viewer is open.")
        print("Close the viewer window or press Ctrl+C to stop.")
        try:
            import time
            # Keep process alive - viewer will close when this process exits
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nClosing Rerun viewer...")


def main():
    parser = argparse.ArgumentParser(description="Visualize URDF episodes with Rerun")
    parser.add_argument("--episode", type=str, help="Episode JSON data (file path or JSON string)")
    parser.add_argument("--episode-file", type=str, help="Episode JSON file path")
    parser.add_argument("--urdf", type=str, help="URDF content (file path or XML string)")
    parser.add_argument("--urdf-file", type=str, help="URDF file path")
    parser.add_argument("--recording", type=str, default="lerobot/episode", help="Rerun recording name")
    parser.add_argument("--spawn", action="store_true", default=True, help="Spawn Rerun viewer (default: True)")
    parser.add_argument("--no-spawn", dest="spawn", action="store_false", help="Don't spawn viewer")
    parser.add_argument("--serve", action="store_true", help="Serve Rerun over WebSocket (distant mode)")
    parser.add_argument("--web-port", type=int, default=9090, help="Web port for serve mode")
    parser.add_argument("--ws-port", type=int, default=9876, help="WebSocket port for serve mode")

    args = parser.parse_args()

    # Determine episode source
    episode_arg = args.episode_file if args.episode_file else args.episode
    if not episode_arg:
        print("ERROR: Either --episode or --episode-file is required", file=sys.stderr)
        sys.exit(1)

    # Load episode data
    try:
        if args.episode_file or not (episode_arg.startswith("{") or episode_arg.startswith("[")):
            # File path
            with open(episode_arg, "r") as f:
                episode_data = json.load(f)
        else:
            # JSON string
            episode_data = json.loads(episode_arg)
    except Exception as e:
        print(f"ERROR: Failed to load episode data: {e}", file=sys.stderr)
        sys.exit(1)

    # Determine URDF source
    urdf_arg = args.urdf_file if args.urdf_file else args.urdf
    if not urdf_arg:
        print("ERROR: Either --urdf or --urdf-file is required", file=sys.stderr)
        sys.exit(1)

    # Load URDF
    try:
        if args.urdf_file or not urdf_arg.startswith("<"):
            # File path
            with open(urdf_arg, "r") as f:
                urdf_content = f.read()
        else:
            # XML string
            urdf_content = urdf_arg
    except Exception as e:
        print(f"ERROR: Failed to load URDF: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Visualize
    visualize_episode(
        episode_data,
        urdf_content,
        recording_name=args.recording,
        spawn=args.spawn,
        serve=args.serve,
        web_port=args.web_port,
        ws_port=args.ws_port,
    )


if __name__ == "__main__":
    main()

