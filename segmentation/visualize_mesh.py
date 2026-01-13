import trimesh
import sys
import os

def visualize(mesh_path):
    if not os.path.exists(mesh_path):
        print(f"Error: File {mesh_path} not found.")
        return

    try:
        # Load the mesh
        # force='mesh' ensures we get a Trimesh object if possible, 
        # though .obj usually loads as such or a Scene.
        mesh = trimesh.load(mesh_path, force='mesh')
        
        print(f"Loaded mesh from {mesh_path}")
        print(f"Vertices: {len(mesh.vertices)}")
        print(f"Faces: {len(mesh.faces)}")
        
        # Create a scene to add lights and camera if needed, 
        # but mesh.show() handles basic setup.
        print("Opening visualization window...")
        mesh.show()
        
    except Exception as e:
        print(f"Failed to visualize mesh: {e}")
        print("\nNote: Visualization requires a display environment (GUI).")
        print("If you are running on a headless server, you cannot open a window.")

if __name__ == "__main__":
    # Default to output_mesh.obj if no argument provided
    mesh_path = "output_mesh.obj"
    if len(sys.argv) > 1:
        mesh_path = sys.argv[1]
    
    visualize(mesh_path)
