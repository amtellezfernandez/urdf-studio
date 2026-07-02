from __future__ import annotations

from backend.models.simulator_runtime import SIMULATOR_MJLAB_ID
from backend.scripts.mujoco_workspace_prepare import main as _mujoco_workspace_main


def main() -> int:
    return _mujoco_workspace_main(
        default_simulator_id=SIMULATOR_MJLAB_ID,
        simulator_choices=(SIMULATOR_MJLAB_ID,),
    )


if __name__ == "__main__":
    raise SystemExit(main())
