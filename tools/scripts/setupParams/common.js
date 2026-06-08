export const SETUP_SUPPORT_LINKS = {
  huggingFaceTokenUrl: 'https://huggingface.co/settings/tokens',
  githubFineGrainedTokenUrl: 'https://github.com/settings/tokens?type=beta',
  githubCliLoginCommand: 'gh auth login',
  localIluCommand: 'npx ilu',
};

export const GLOBAL_ILU_SETUP = {
  installFlag: '--install-global-ilu',
  installEnv: 'URDF_STUDIO_INSTALL_GLOBAL_ILU',
  installCommand: 'npm run setup -- --install-global-ilu',
};

export const NODE_INSTALL_SETUP = {
  npmInstallFlags: ['--no-fund', '--audit=false', '--loglevel=error'],
};

export const PYTHON_TOOLCHAIN_SETUP = {
  lerobotEnvDirname: '.venv-lerobot',
  backendEnvDirname: '.venv-lerobot',
};

export const HUGGING_FACE_TOKEN_URL = SETUP_SUPPORT_LINKS.huggingFaceTokenUrl;
export const GITHUB_FINE_GRAINED_TOKEN_URL = SETUP_SUPPORT_LINKS.githubFineGrainedTokenUrl;
export const GITHUB_CLI_LOGIN_COMMAND = SETUP_SUPPORT_LINKS.githubCliLoginCommand;
export const LOCAL_ILU_COMMAND = SETUP_SUPPORT_LINKS.localIluCommand;
export const GLOBAL_ILU_INSTALL_FLAG = GLOBAL_ILU_SETUP.installFlag;
export const GLOBAL_ILU_INSTALL_ENV = GLOBAL_ILU_SETUP.installEnv;
export const GLOBAL_ILU_INSTALL_COMMAND = GLOBAL_ILU_SETUP.installCommand;
export const SETUP_NPM_INSTALL_FLAGS = NODE_INSTALL_SETUP.npmInstallFlags;
export const LEROBOT_TOOLCHAIN_DIRNAME = PYTHON_TOOLCHAIN_SETUP.lerobotEnvDirname;
export const PYTHON_ENV_DIRNAME = PYTHON_TOOLCHAIN_SETUP.backendEnvDirname;
