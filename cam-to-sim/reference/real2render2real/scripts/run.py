"""Launch Isaac Sim Simulator first."""
import argparse
from isaaclab.app import AppLauncher
# add argparse arguments
parser = argparse.ArgumentParser(description="This script runs Real2Render2Real environments.")
AppLauncher.add_app_launcher_args(parser)
# parse the arguments
args_cli = parser.parse_args()
# launch omniverse app
args_cli.headless = True # Defaulted True for headless development
args_cli.enable_cameras = True # Defaulted True for rendering viewpoints
print(args_cli)
app_launcher = AppLauncher(args_cli)
simulation_app = app_launcher.app

# import pdb; pdb.set_trace()
# import websockets
# websockets.__file__

from real2render2real.isaaclab_viser.configs.scene_configs.yumi_scene_cfg import (
    YumiCoffeeMakerCfg, YumiFaucetCfg, YumiDrawerOpenCfg, YumiTigerPickR2R2RCfg, YumiCardboardPickupCfg
)

from real2render2real.isaaclab_viser.yumi_simulators.yumi_coffee_maker import CoffeeMaker
from real2render2real.isaaclab_viser.yumi_simulators.yumi_drawer_open import DrawerOpen
from real2render2real.isaaclab_viser.yumi_simulators.yumi_faucet import Faucet
from real2render2real.isaaclab_viser.yumi_simulators.yumi_tiger_pick_r2r2r import TigerPickR2R2R
from real2render2real.isaaclab_viser.yumi_simulators.yumi_cardboard_lift import CardboardLift

from real2render2real.isaaclab_viser.franka_simulators.franka_coffee_maker import CoffeeMaker as FrankaCoffeeMaker
from real2render2real.isaaclab_viser.configs.scene_configs.franka_scene_cfg import FrankaCoffeeMakerCfg

import os
from pathlib import Path


def main():
    dir_path = os.path.dirname(os.path.realpath(__file__))
    data_dir = os.path.join(dir_path, "../data")
    output_data_dir = os.path.join(dir_path, "../output_data")
    
    ### Scene Configs ###
    # Note, depending on GPU VRAM you may have to decrease num_envs, num_envs=50 should work on a 4090
    
    scene_config = YumiCoffeeMakerCfg(num_envs=2, env_spacing=1.5)
    # scene_config = YumiFaucetCfg(num_envs=2, env_spacing=80.0)
    # scene_config = YumiDrawerOpenCfg(num_envs=2, env_spacing=80.0)
    # scene_config = YumiTigerPickR2R2RCfg(num_envs=2, env_spacing=80.0)
    # scene_config = YumiCardboardPickupCfg(num_envs=2, env_spacing=80.0)
    # scene_config = FrankaCoffeeMakerCfg(num_envs=2, env_spacing=1.5)
    
    output_dir = os.path.join(output_data_dir, "yumi_coffee_maker")
    
    ### Robot URDFs ###
    
    urdf_path = {
        'robot': Path(f'{data_dir}/yumi_description/urdf/yumi.urdf'),
    }
    
    # urdf_path = {
    #     'robot': Path(f'{data_dir}/franka_description/urdfs/fr3_franka_hand.urdf'),
    # }
    
    
    ### Simulators ###
    
    CoffeeMaker(
                simulation_app,
                scene_config, 
                urdf_path = urdf_path,
                save_data=True,
                output_dir = output_dir)
    
    # Faucet(
    #     simulation_app,
    #     scene_config,
    #     urdf_path = urdf_path,
    #     save_data=True,
    #     output_dir = output_dir
    # )
    
    # DrawerOpen(
    #     simulation_app,
    #     scene_config,
    #     urdf_path = urdf_path,
    #     save_data=True,
    #     output_dir = output_dir
    # )
    
    # TigerPickR2R2R(
    #     simulation_app,
    #     scene_config,
    #     urdf_path = urdf_path,
    #     save_data=True,
    #     output_dir = output_dir
    # )
    
    # CardboardLift(
    #     simulation_app,
    #     scene_config,
    #     urdf_path = urdf_path,
    #     save_data=True,
    #     output_dir = output_dir
    # )
    
    # FrankaCoffeeMaker(
    #     simulation_app,
    #     scene_config,
    #     urdf_path = urdf_path,
    #     save_data=True,
    #     output_dir = output_dir)
    
    
    # Using robot USD file in the scene_config and loading the same URDF separately speeds up IsaacLab init 
    # significantly (Avoids running URDF to USD converter)
    
if __name__ == "__main__":
    main()