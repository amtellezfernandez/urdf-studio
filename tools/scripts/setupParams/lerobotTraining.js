import {
  LEROBOT_PIP_DEPENDENCY,
  LEROBOT_SOURCE_VERIFY_SCRIPT,
} from './lerobotSource.js';

export const LEROBOT_TRAINING_SETUP = {
  packages: {
    lerobot: LEROBOT_PIP_DEPENDENCY,
    torch: 'torch',
    safetensors: 'safetensors',
  },
  verifyImportScript: [
    'import torch; import lerobot; import safetensors',
    LEROBOT_SOURCE_VERIFY_SCRIPT,
    'print("lerobot training runtime ok")',
  ].join('\n'),
};

export const LEROBOT_TRAINING_DEPENDENCIES = Object.values(LEROBOT_TRAINING_SETUP.packages);
export const LEROBOT_TRAINING_VERIFY_IMPORT_SCRIPT = LEROBOT_TRAINING_SETUP.verifyImportScript;
