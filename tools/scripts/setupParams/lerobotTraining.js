export const LEROBOT_TRAINING_SETUP = {
  packages: {
    lerobot: 'lerobot',
    torch: 'torch',
    safetensors: 'safetensors',
  },
  verifyImportScript: 'import torch; import lerobot; import safetensors; print("lerobot training runtime ok")',
};

export const LEROBOT_TRAINING_DEPENDENCIES = Object.values(LEROBOT_TRAINING_SETUP.packages);
export const LEROBOT_TRAINING_VERIFY_IMPORT_SCRIPT = LEROBOT_TRAINING_SETUP.verifyImportScript;
