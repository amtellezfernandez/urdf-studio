import torch
from transformers import SamModel, SamProcessor
from PIL import Image
import numpy as np
import cv2 as cv

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = SamModel.from_pretrained("facebook/sam-vit-base").to(device)
processor = SamProcessor.from_pretrained("facebook/sam-vit-base")

"""
Segmentor Module that takes in an image and input points to generate segmentation masks.
"""

class Segmentor:
    def __init__(self, model, processor, device):
        self.model = model
        self.processor = processor
        self.device = device

    def segment(self, image_input, input_points):
        if isinstance(image_input, str):
            image = Image.open(image_input).convert("RGB")
        elif isinstance(image_input, np.ndarray):
            # OpenCV uses BGR, PIL uses RGB
            image = Image.fromarray(cv.cvtColor(image_input, cv.COLOR_BGR2RGB))
        elif isinstance(image_input, Image.Image):
            image = image_input.convert("RGB")
        else:
            raise ValueError("image_input must be a path, numpy array, or PIL Image")

        points = [[[ [int(x), int(y)] for (x, y) in input_points ]]]
        labels = [[[1] * len(input_points)]]

        inputs = self.processor(
            images=image,
            input_points=points,
            input_labels=labels,
            return_tensors="pt"
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model(**inputs)

        pred_masks = outputs.pred_masks
        iou_scores = outputs.iou_scores

        # Convert to original image size
        processed = self.processor.post_process_masks(
            masks=pred_masks,
            reshaped_input_sizes=inputs["reshaped_input_sizes"],
            original_sizes=inputs["original_sizes"]
        )

        # processed is a list per batch; we have batch=1
        masks = processed[0]  # shape: [point_batch, num_masks, H, W] or similar
        scores = iou_scores.cpu().numpy()

        # Normalize to a flat list of 2D uint8 masks
        flat_masks = []
        flat_scores = []
        masks_np = masks.cpu().numpy() if hasattr(masks, "cpu") else np.array(masks)
        
        for i, mask_group in enumerate(np.array(masks_np)):
            score_group = scores[0][i]
            for j, m in enumerate(np.array(mask_group)):
                m2d = np.squeeze(m)               # remove singleton dims → HxW
                m2d = (m2d > 0).astype(np.uint8)  # ensure binary 0/1
                flat_masks.append(m2d)
                flat_scores.append(score_group[j])
        return flat_masks, flat_scores

# Example usage
if __name__ == "__main__":
    segmentor = Segmentor(model, processor, device)
    image_path = "redbull.jpg"

    # get input from user input using cv2
    input_points = []

    def mouse_callback(event, x, y, flags, param):
        if event == cv.EVENT_LBUTTONDOWN:
            input_points.append([x, y])
            print(f"Point added: ({x}, {y})")

    cv.namedWindow("Input Image")
    cv.setMouseCallback("Input Image", mouse_callback)
    img = cv.imread(image_path)
    
    while True:
        cv.imshow("Input Image", img)
        if cv.waitKey(1) & 0xFF == ord('q'):
            break
    cv.destroyAllWindows()
    cv.waitKey(1)

    if len(input_points) == 0:
        print("No input points provided. Exiting.")
    else:
        masks, scores = segmentor.segment(image_path, input_points)
        
        print(f"Generated {len(masks)} candidate masks.")
        
        # Display candidates
        for i, (mask, score) in enumerate(zip(masks, scores)):
            masked_preview = cv.bitwise_and(img, img, mask=mask)
            cv.imshow(f"Candidate {i} (Score: {score:.4f})", masked_preview)
            print(f"Candidate {i}: Score {score:.4f}")

        print("Check the open windows for candidate masks.")
        cv.waitKey(100) # Give time for windows to draw

        try:
            selected_idx = int(input("Enter the index of the desired mask: "))
            if 0 <= selected_idx < len(masks):
                selected_mask = masks[selected_idx]
                masked_img = cv.bitwise_and(img, img, mask=selected_mask)
                cv.imwrite("masked_image.png", masked_img)
                print(f"Saved masked_image.png using candidate {selected_idx}")
            else:
                print("Invalid index selected.")
        except ValueError:
            print("Invalid input. Please enter a number.")
            
        cv.destroyAllWindows()

    