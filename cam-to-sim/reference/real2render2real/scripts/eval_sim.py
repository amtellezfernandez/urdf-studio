"""Launch Isaac Sim Simulator first."""
import argparse
from omni.isaac.lab.app import AppLauncher
# add argparse arguments
parser = argparse.ArgumentParser(description="This script tests YuMi with random jitter in a physics environment.")
AppLauncher.add_app_launcher_args(parser)
# parse the arguments
args_cli = parser.parse_args()
# launch omniverse app
args_cli.headless = True # Defaulted True for headless development
args_cli.enable_cameras = True # Defaulted True for rendering viewpoints
print(args_cli)
app_launcher = AppLauncher(args_cli)
simulation_app = app_launcher.app

from xi.isaaclab_viser.configs.scene_configs.yumi_scene_cfg import (
    YumiPickTigerCfg
)
from xi.xi.isaaclab_viser.yumi_simulators.yumi_pick_tiger_sim_eval import PickTigerEvalDP
import os
from pathlib import Path


def main():
    dir_path = os.path.dirname(os.path.realpath(__file__))
    data_dir = os.path.join(dir_path, "../data")
    
    scene_config = YumiPickTigerCfg(num_envs=1, env_spacing=80.0)
    output_dir = os.path.join(dir_path, "../output_data/yumi_pick_tiger_sim_eval")
    urdf_path = {
        'robot': Path(f'{data_dir}/yumi_description/urdf/yumi.urdf'),
    }
    PickTigerEvalDP(
                simulation_app,
                scene_config, 
                urdf_path = urdf_path,
                save_data=True,
                output_dir = output_dir,
                ckpt_path="/home/xi/checkpoints/250120_1346",
                ckpt_id=185,
                ).run_simulator()
    # Using robot USD file in the scene_config and loading the same URDF separately speeds up IsaacLab init 
    # significantly (Avoids running URDF to USD converter)
    
if __name__ == "__main__":
    main()
