import argparse
# from omni.isaac.lab.app import AppLauncher
from isaaclab.app import AppLauncher

# add argparse arguments
parser = argparse.ArgumentParser(description="This script converting usd.")
parser.add_argument("--path", type=str, help="Path to the file")

AppLauncher.add_app_launcher_args(parser)
# parse the arguments
args_cli = parser.parse_args()
# launch omniverse app
args_cli.headless = True # Defaulted True for headless development
print(args_cli)
app_launcher = AppLauncher(args_cli)
simulation_app = app_launcher.app

import isaaclab.sim as sim_utils
from isaaclab.sim.converters import UrdfConverter, UrdfConverterCfg, AssetConverterBaseCfg, AssetConverterBase
import tyro
import os
import omni.usd
import omni.client

from pxr import UsdGeom, Sdf

def urdf_to_usd(urdf_path):
    urdf_dir = os.path.dirname(urdf_path)
    
    cfg = UrdfConverterCfg(
        asset_path=urdf_path,
        usd_dir=urdf_dir,
        force_usd_conversion=True,
        make_instanceable=True,
        fix_base=True,
        rigid_props=sim_utils.RigidBodyPropertiesCfg(
            disable_gravity=False,
            max_depenetration_velocity=5.0,
        ),
        articulation_props=sim_utils.ArticulationRootPropertiesCfg(
            enabled_self_collisions=True, solver_position_iteration_count=8, solver_velocity_iteration_count=0
        ),
        activate_contact_sensors=False,
    )
    UrdfConverter(cfg)

def create_parent_xforms(asset_usd_path, source_prim_path, save_as_path=None):
    """ Adds a new UsdGeom.Xform prim for each Mesh/Geometry prim under source_prim_path.
        Moves material assignment to new parent prim if any exists on the Mesh/Geometry prim.

        Args:
            asset_usd_path (str): USD file path for asset
            source_prim_path (str): USD path of root prim
            save_as_path (str): USD file path for modified USD stage. Defaults to None, will save in same file.
    """
    omni.usd.get_context().open_stage(asset_usd_path)
    stage = omni.usd.get_context().get_stage()

    prims = [stage.GetPrimAtPath(source_prim_path)]
    edits = Sdf.BatchNamespaceEdit()
    while len(prims) > 0:
        prim = prims.pop(0)
        if prim.GetTypeName() in ["Mesh", "Capsule", "Sphere", "Box", "Cube"]:
            new_xform = UsdGeom.Xform.Define(stage, str(prim.GetPath()) + "_xform")
            edits.Add(Sdf.NamespaceEdit.Reparent(prim.GetPath(), new_xform.GetPath(), 0))
            continue

        children_prims = prim.GetChildren()
        prims = prims + children_prims

    stage.GetRootLayer().Apply(edits)

    if save_as_path is None:
        omni.usd.get_context().save_stage()
    else:
        omni.usd.get_context().save_as_stage(save_as_path)
        
def convert_asset_instanceable(asset_usd_path, source_prim_path, save_as_path=None, create_xforms=True):
    """ Makes all mesh/geometry prims instanceable.
        Can optionally add UsdGeom.Xform prim as parent for all mesh/geometry prims.
        Makes a copy of the asset USD file, which will be used for referencing.
        Updates asset file to convert all parent prims of mesh/geometry prims to reference cloned USD file.

        Args:
            asset_usd_path (str): USD file path for asset
            source_prim_path (str): USD path of root prim
            save_as_path (str): USD file path for modified USD stage. Defaults to None, will save in same file.
            create_xforms (bool): Whether to add new UsdGeom.Xform prims to mesh/geometry prims.
    """

    if create_xforms:
        save_as_path_xform = asset_usd_path.replace('.usd', '_xform.usd')
        create_parent_xforms(asset_usd_path, source_prim_path, save_as_path_xform)
        asset_usd_path = save_as_path_xform

    instance_usd_path = ".".join(asset_usd_path.split(".")[:-1]) + "_meshes.usd"
    omni.client.copy(asset_usd_path, instance_usd_path)
    omni.usd.get_context().open_stage(asset_usd_path)
    stage = omni.usd.get_context().get_stage()

    prims = [stage.GetPrimAtPath(source_prim_path+'_xform')]
    while len(prims) > 0:
        prim = prims.pop(0)
        if prim:
            if prim.GetTypeName() in ["Mesh", "Capsule", "Sphere", "Box", 'Cube']:
                parent_prim = prim.GetParent()
                print("parent_prim", parent_prim)
                if parent_prim and not parent_prim.IsInstance():
                    parent_prim.GetReferences().AddReference(assetPath=instance_usd_path, primPath=str(parent_prim.GetPath()))
                    parent_prim.SetInstanceable(True)
                    continue


            children_prims = prim.GetChildren()
            prims = prims + children_prims

    if save_as_path is None:
        omni.usd.get_context().save_stage()
    else:
        omni.usd.get_context().save_as_stage(save_as_path)


def main(path):
    
    # urdf_to_usd(path)
    convert_asset_instanceable(path, "/table2", save_as_path=path.replace('.usd', '_instanceable.usd'), create_xforms=True)
    
    
if __name__ == "__main__":
    main(args_cli.path)