export const PYBULLET_SETUP = {
  skipAutoInstallEnv: 'URDF_STUDIO_SKIP_PYBULLET_AUTO_INSTALL',
  forceInstallEnv: 'URDF_STUDIO_INSTALL_PYBULLET',
  packages: {
    pybullet: 'pybullet',
  },
  verifyImportScript: 'import pybullet; import pybullet_data; print("pybullet workspace adapter runtime ok")',
};

export const PYBULLET_SKIP_AUTO_INSTALL_ENV = PYBULLET_SETUP.skipAutoInstallEnv;
export const PYBULLET_FORCE_INSTALL_ENV = PYBULLET_SETUP.forceInstallEnv;
export const PYBULLET_PACKAGE = PYBULLET_SETUP.packages.pybullet;
export const PYBULLET_DEPENDENCIES = Object.values(PYBULLET_SETUP.packages);
export const PYBULLET_VERIFY_IMPORT_SCRIPT = PYBULLET_SETUP.verifyImportScript;
