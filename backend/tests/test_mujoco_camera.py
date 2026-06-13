from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace


def test_write_mujoco_camera_screenshots_renders_named_camera(tmp_path: Path) -> None:
    import mujoco

    from backend.services.simulator_adapters.mujoco_camera import (
        write_mujoco_camera_screenshots,
    )

    mjcf = """
<mujoco model="camera_test">
  <worldbody>
    <light name="top" pos="0 0 3"/>
    <camera name="top_camera" pos="0 0 2" quat="1 0 0 0" fovy="60"/>
    <geom name="red_box" type="box" pos="0 0 0" size="0.3 0.3 0.1" rgba="1 0 0 1"/>
  </worldbody>
</mujoco>
""".strip()
    mjcf_path = tmp_path / "robot.xml"
    output_dir = tmp_path / "cameras"
    mjcf_path.write_text(mjcf, encoding="utf-8")
    model = mujoco.MjModel.from_xml_path(str(mjcf_path))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    camera = SimpleNamespace(sim_name="top_camera", width=160, height=120)

    written_count = write_mujoco_camera_screenshots(
        mujoco,
        model,
        data,
        [camera],
        output_dir,
    )

    assert written_count == 1
    image_path = output_dir / "01_top_camera.png"
    assert image_path.exists()

    from PIL import Image

    image = Image.open(image_path).convert("RGB")
    assert max(high - low for low, high in image.getextrema()) > 5
