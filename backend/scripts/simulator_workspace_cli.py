from __future__ import annotations

import argparse

WORKSPACE_FRAME_MAP_CHOICES = ("auto", "studio-y-up-to-z-up", "identity")


def add_common_workspace_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--world-package", required=True)
    parser.add_argument(
        "--frame-map",
        choices=WORKSPACE_FRAME_MAP_CHOICES,
        default="identity",
    )
    parser.add_argument("--duration-sec", type=float, default=0.0)
    parser.add_argument("--include-hidden", action="store_true")
    parser.add_argument("--no-viewer", action="store_true")
