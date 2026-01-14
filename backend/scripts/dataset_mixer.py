#!/usr/bin/env python3
"""
Dataset Mixer using RoboCandyWrapper
Mixes local datasets with Hugging Face datasets
"""

import json
import sys
import argparse
import tempfile
import shutil
from pathlib import Path
from typing import List, Dict, Optional

try:
    from robocandywrapper import make_dataset_without_config
except ImportError:
    print("ERROR: robocandywrapper is not installed. Run: pip install robocandywrapper", file=sys.stderr)
    sys.exit(1)


def mix_datasets(
    repo_ids: List[str],
    local_dataset_paths: Optional[List[str]] = None,
    output_path: Optional[str] = None,
) -> Dict:
    """
    Mix datasets from Hugging Face and local paths.
    
    Args:
        repo_ids: List of Hugging Face dataset IDs (e.g., ["lerobot/svla_so100_pickplace"])
        local_dataset_paths: List of local dataset paths (directories containing LeRobot datasets)
        output_path: Optional path to save the mixed dataset
    
    Returns:
        Dict with mixed dataset info
    """
    all_repos = list(repo_ids) if repo_ids else []
    
    # Add local datasets as file paths
    if local_dataset_paths:
        for local_path in local_dataset_paths:
            path = Path(local_path)
            if path.exists() and path.is_dir():
                all_repos.append(str(path.absolute()))
            elif path.exists() and path.is_file() and path.suffix == '.zip':
                # Handle zip files - extract to temp directory
                temp_dir = Path(tempfile.mkdtemp(prefix="dataset_zip_"))
                try:
                    import zipfile
                    with zipfile.ZipFile(path, 'r') as zip_ref:
                        zip_ref.extractall(temp_dir)
                    all_repos.append(str(temp_dir))
                except Exception as e:
                    print(f"WARNING: Failed to extract zip {local_path}: {e}", file=sys.stderr)
            else:
                print(f"WARNING: Local dataset path not found: {local_path}", file=sys.stderr)
    
    if not all_repos:
        return {
            "success": False,
            "error": "No valid datasets provided"
        }
    
    print(f"Loading and mixing {len(all_repos)} dataset(s)...", file=sys.stderr)
    
    try:
        # Load and mix datasets using RoboCandyWrapper
        dataset = make_dataset_without_config(all_repos)
        
        # Get dataset info
        total_episodes = len(dataset)
        
        info = {
            "total_episodes": total_episodes,
            "datasets_loaded": len(all_repos),
            "dataset_sources": all_repos,
        }
        
        # If output path is specified, save the mixed dataset
        if output_path:
            output_dir = Path(output_path)
            output_dir.mkdir(parents=True, exist_ok=True)
            print(f"Output path specified: {output_path}", file=sys.stderr)
            # Note: Actual saving would depend on RoboCandyWrapper API
            # For now, we just return the info
        
        return {
            "success": True,
            "info": info,
            "total_episodes": total_episodes,
            "output_path": str(output_path) if output_path else None,
        }
        
    except Exception as e:
        error_msg = str(e)
        print(f"ERROR: Failed to mix datasets: {error_msg}", file=sys.stderr)
        return {
            "success": False,
            "error": error_msg,
        }


def main():
    parser = argparse.ArgumentParser(description="Mix LeRobot datasets using RoboCandyWrapper")
    parser.add_argument(
        "--repo-ids",
        type=str,
        nargs="+",
        help="Hugging Face dataset IDs (e.g., lerobot/svla_so100_pickplace)",
    )
    parser.add_argument(
        "--local-paths",
        type=str,
        nargs="+",
        help="Local dataset directory paths or zip files",
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Output directory for mixed dataset (optional)",
    )
    
    args = parser.parse_args()
    
    if not args.repo_ids and not args.local_paths:
        result = {
            "success": False,
            "error": "At least one --repo-ids or --local-paths is required"
        }
        print(json.dumps(result))
        sys.exit(1)
    
    result = mix_datasets(
        repo_ids=args.repo_ids or [],
        local_dataset_paths=args.local_paths,
        output_path=args.output,
    )
    
    # Output result as JSON
    print(json.dumps(result))
    
    # Exit with error code if failed
    if not result.get("success", False):
        sys.exit(1)


if __name__ == "__main__":
    main()

