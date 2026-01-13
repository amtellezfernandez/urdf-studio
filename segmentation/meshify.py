import sys
import os
import numpy as np
import torch
from PIL import Image
import cv2 as cv

# Add TripoSR to path
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "TripoSR"))

from tsr.system import TSR
from tsr.utils import resize_foreground

class TripoMeshifier:
    def __init__(self, device="cuda:0"):
        self.device = device
        if not torch.cuda.is_available():
            self.device = "cpu"
        
        print(f"Initializing TripoSR on {self.device}...")
        self.model = TSR.from_pretrained(
            "stabilityai/TripoSR",
            config_name="config.yaml",
            weight_name="model.ckpt",
        )
        self.model.renderer.set_chunk_size(8192)
        self.model.to(self.device)

    def preprocess_image(self, image_path):
        # Load image
        img = cv.imread(image_path)
        if img is None:
            raise ValueError(f"Could not load image from {image_path}")
            
        img = cv.cvtColor(img, cv.COLOR_BGR2RGB)
        
        # Create alpha channel based on black background
        # We assume the masked image has black background (0,0,0)
        gray = cv.cvtColor(img, cv.COLOR_RGB2GRAY)
        _, mask = cv.threshold(gray, 1, 255, cv.THRESH_BINARY)
        
        # Create RGBA
        rgba = cv.cvtColor(img, cv.COLOR_RGB2RGBA)
        rgba[:, :, 3] = mask
        
        pil_image = Image.fromarray(rgba)
        
        # Resize foreground
        image = resize_foreground(pil_image, 0.85)
        
        # Composite on gray background
        image = np.array(image).astype(np.float32) / 255.0
        image = image[:, :, :3] * image[:, :, 3:4] + (1 - image[:, :, 3:4]) * 0.5
        image = Image.fromarray((image * 255.0).astype(np.uint8))
        
        return image

    def meshify(self, image_path, output_path):
        print(f"Processing {image_path}...")
        image = self.preprocess_image(image_path)
        
        print("Running model...")
        with torch.no_grad():
            scene_codes = self.model([image], device=self.device)
            
        print("Extracting mesh...")
        meshes = self.model.extract_mesh(scene_codes, has_vertex_color=True, resolution=256)
        meshes[0].export(output_path)
        print(f"Mesh saved to {output_path}")

if __name__ == "__main__":
    meshifier = TripoMeshifier()
    if os.path.exists("masked_image.png"):
        meshifier.meshify("masked_image.png", "output_mesh.obj")
    else:
        print("masked_image.png not found. Please run segment.py first.")
