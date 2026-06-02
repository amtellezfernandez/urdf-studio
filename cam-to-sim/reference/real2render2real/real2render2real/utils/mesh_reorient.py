import argparse
import datetime
import trimesh
import numpy as np

from pathlib import Path
import viser
import viser.transforms as tf
import time
from scipy.spatial.transform import Rotation

def apply_inverse_frame_transform(mesh: trimesh.Trimesh, wxyz: np.ndarray) -> trimesh.Trimesh:
    """
    Apply inverse of frame transform to mesh vertices, making the frame the new world origin.
    """
    # Convert wxyz quaternion to scipy Rotation (note: switching from wxyz to xyzw order)
    r = Rotation.from_quat([wxyz[1], wxyz[2], wxyz[3], wxyz[0]])
    
    # Get the inverse rotation
    r_inv = r.inv()
    
    # Apply inverse rotation to vertices
    transformed_mesh = mesh.copy()
    transformed_mesh.vertices = r_inv.apply(mesh.vertices)
    return transformed_mesh

def recenter_and_visualize_obj(input_path: str, output_path: str = None, scale: float = 1.0) -> None:
    """
    Read an OBJ file, recenter its vertices around the origin, save the result,
    and visualize with adjustable frame transform.
    """
    # Handle output path
    input_path = Path(input_path)
    if output_path is None:
        output_path = input_path.parent / f'{input_path.stem}_recentered{input_path.suffix}'
    
    # Load mesh using trimesh
    mesh = trimesh.load_mesh(str(input_path))
    assert isinstance(mesh, trimesh.Trimesh)
    
    # Calculate centroid
    centroid = mesh.vertices.mean(axis=0)
    print(f'Original centroid: {centroid}')
    
    # Create recentered mesh
    recentered_mesh = mesh.copy()
    recentered_mesh.vertices = mesh.vertices - centroid
    
    # Apply scaling if requested
    if scale != 1.0:
        recentered_mesh.apply_scale(scale)
    
    # Save initial recentered mesh
    recentered_mesh.export(str(output_path))
    print(f'Initial recentered mesh saved to {output_path}')
    
    # Set up viser visualization
    server = viser.ViserServer()
    
    # Add recentered mesh
    server.scene.add_mesh_trimesh(
        name="/recentered",
        mesh=recentered_mesh,
        wxyz=tf.SO3.from_x_radians(np.pi / 2).wxyz,
        position=(0.0, 0.0, 0.0),
    )
    
    frame = server.scene.add_transform_controls(
        "/recentered/transform_control",
        disable_axes=True,
        disable_sliders=True,
    )
    
    server.scene.add_frame(
        "/recentered/transform_control/frame",
        axes_radius=0.01,
    )
    
    last_wxyz = None
    transformed_output_path = input_path.parent / f'{input_path.stem}_transformed{input_path.suffix}'
    
    # Keep server running
    try:
        while True:
            time.sleep(1.0)
            current_wxyz = frame.wxyz
            
            # If rotation has changed, apply inverse transform and save
            if last_wxyz is None or not np.allclose(current_wxyz, last_wxyz):
                print(f"New frame rotation (wxyz): {current_wxyz}")
                
                # Apply inverse transform to recentered mesh
                transformed_mesh = apply_inverse_frame_transform(recentered_mesh, current_wxyz)
                
                # Save transformed mesh
                transformed_mesh.export(str(transformed_output_path))
                print(f'Saved transformed mesh to {transformed_output_path}')
                
                last_wxyz = current_wxyz
                
    except KeyboardInterrupt:
        print("Shutting down visualization server...")
        
        # Save final transform if it exists
        if last_wxyz is not None:
            print(f"Final frame rotation (wxyz): {last_wxyz}")
            transformed_mesh = apply_inverse_frame_transform(recentered_mesh, last_wxyz)
            transformed_mesh.export(str(transformed_output_path))
            print(f'Saved final transformed mesh to {transformed_output_path}')

def main():
    parser = argparse.ArgumentParser(description='Recenter an OBJ file and visualize with frame transform')
    parser.add_argument('input', type=str, help='Input OBJ file path')
    parser.add_argument('--output', type=str, help='Output OBJ file path (default: input_recentered.obj)')
    parser.add_argument('--scale', type=float, default=1.0, help='Scale factor to apply to mesh')
    
    args = parser.parse_args()
    recenter_and_visualize_obj(args.input, args.output, args.scale)

if __name__ == '__main__':
    main()