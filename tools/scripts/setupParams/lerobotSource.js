export const LEROBOT_UPSTREAM_REPO_URL = 'https://github.com/huggingface/lerobot.git';
export const LEROBOT_UPSTREAM_REF = '6a788fbdb02cabfae60f7408636945df0b1eafa0';
export const LEROBOT_GIT_URL = `git+${LEROBOT_UPSTREAM_REPO_URL}@${LEROBOT_UPSTREAM_REF}`;
export const LEROBOT_PIP_INSTALL_FLAGS = ['--upgrade'];
export const LEROBOT_PIP_DEPENDENCY = `lerobot @ ${LEROBOT_GIT_URL}`;
export const LEROBOT_OPENARM_HARDWARE_PIP_DEPENDENCY =
  `lerobot[feetech,damiao] @ ${LEROBOT_GIT_URL}`;

export const LEROBOT_SOURCE_VERIFY_SCRIPT = [
  'import json',
  'from importlib import metadata',
  'from pathlib import Path',
  `expected_lerobot_commit = ${JSON.stringify(LEROBOT_UPSTREAM_REF)}`,
  'lerobot_distribution = metadata.distribution("lerobot")',
  'direct_url_path = None',
  'for installed_file in lerobot_distribution.files or ():',
  '    if installed_file.name == "direct_url.json":',
  '        candidate = Path(lerobot_distribution.locate_file(installed_file))',
  '        if candidate.is_file():',
  '            direct_url_path = candidate',
  '            break',
  'if direct_url_path is None:',
  '    dist_info_path = getattr(lerobot_distribution, "_path", None)',
  '    if dist_info_path is not None:',
  '        candidate = Path(dist_info_path) / "direct_url.json"',
  '        if candidate.is_file():',
  '            direct_url_path = candidate',
  'if direct_url_path is None:',
  '    raise RuntimeError(',
  '        "lerobot is installed without direct_url.json; "',
  '        "rerun setup to install the pinned upstream LeRobot revision"',
  '    )',
  'direct_url = json.loads(direct_url_path.read_text(encoding="utf-8"))',
  'installed_lerobot_commit = direct_url.get("vcs_info", {}).get("commit_id")',
  'if installed_lerobot_commit != expected_lerobot_commit:',
  '    raise RuntimeError(',
  '        f"lerobot commit mismatch: expected {expected_lerobot_commit}, "',
  '        f"got {installed_lerobot_commit}"',
  '    )',
].join('\n');
