export const MJLAB_SETUP = {
  skipAutoInstallEnv: 'URDF_STUDIO_SKIP_MJLAB_AUTO_INSTALL',
  forceInstallEnv: 'URDF_STUDIO_INSTALL_MJLAB',
  packages: {
    mjlab: 'mjlab',
    mujoco: 'mujoco',
    mujocoWarp: 'mujoco-warp==3.9.0.1',
  },
  verifyImportScript: 'import mjlab; import mujoco; import mujoco_warp; print("mjlab runtime ok")',
};

export const MJLAB_SKIP_AUTO_INSTALL_ENV = MJLAB_SETUP.skipAutoInstallEnv;
export const MJLAB_FORCE_INSTALL_ENV = MJLAB_SETUP.forceInstallEnv;
export const MJLAB_MUJOCO_WARP_PACKAGE = MJLAB_SETUP.packages.mujocoWarp;
export const MJLAB_DEPENDENCIES = Object.values(MJLAB_SETUP.packages);
export const MJLAB_VERIFY_IMPORT_SCRIPT = MJLAB_SETUP.verifyImportScript;
