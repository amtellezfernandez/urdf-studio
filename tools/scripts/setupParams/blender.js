export const BLENDER_SETUP = Object.freeze({
  skipAutoInstallEnv: 'URDF_STUDIO_SKIP_BLENDER_AUTO_INSTALL',
  forceInstallEnv: 'URDF_STUDIO_INSTALL_BLENDER',
  pathEnv: 'URDF_STUDIO_BLENDER_PATH',
  portableVersion: '4.5.10',
  portablePlatform: 'linux-x64',
  portableRelease: 'Blender4.5',
  portableArchive: 'blender-4.5.10-linux-x64.tar.xz',
  portableDownloadUrl:
    'https://download.blender.org/release/Blender4.5/blender-4.5.10-linux-x64.tar.xz',
});

export const BLENDER_SKIP_AUTO_INSTALL_ENV = BLENDER_SETUP.skipAutoInstallEnv;
export const BLENDER_FORCE_INSTALL_ENV = BLENDER_SETUP.forceInstallEnv;
export const BLENDER_PATH_ENV = BLENDER_SETUP.pathEnv;
