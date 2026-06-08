export const GENESIS_SETUP = {
  skipAutoInstallEnv: 'URDF_STUDIO_SKIP_GENESIS_AUTO_INSTALL',
  forceInstallEnv: 'URDF_STUDIO_INSTALL_GENESIS',
  packages: {
    world: 'genesis-world==1.1.0',
    renderer: 'imgui-bundle==1.92.801',
  },
  verifyImportScript: 'import genesis; import imgui_bundle; print("genesis static world viewer runtime ok")',
};

export const GENESIS_SKIP_AUTO_INSTALL_ENV = GENESIS_SETUP.skipAutoInstallEnv;
export const GENESIS_FORCE_INSTALL_ENV = GENESIS_SETUP.forceInstallEnv;
export const GENESIS_WORLD_PACKAGE = GENESIS_SETUP.packages.world;
export const GENESIS_RENDER_PACKAGE = GENESIS_SETUP.packages.renderer;
export const GENESIS_PYTHON_DEPENDENCIES = Object.values(GENESIS_SETUP.packages);
export const GENESIS_VERIFY_IMPORT_SCRIPT = GENESIS_SETUP.verifyImportScript;
