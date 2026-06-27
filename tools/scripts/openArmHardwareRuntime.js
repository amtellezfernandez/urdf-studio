import { OPENARM_HARDWARE_DOCTOR_IMPORTS } from './openArmHardwareParams.js';
import { LEROBOT_SOURCE_VERIFY_SCRIPT } from './setupParams/lerobotSource.js';

const OPENARM_LEROBOT_COMPATIBILITY_VERIFY_SCRIPT = [
  'from lerobot.robots.openarm_follower.config_openarm_follower import OpenArmFollowerConfigBase',
  'if "use_velocity_and_torque" not in OpenArmFollowerConfigBase.__dataclass_fields__:',
  '    raise RuntimeError("pinned lerobot is missing OpenArm position-only teleop compatibility")',
].join('\n');

export function buildOpenArmHardwareVerifyImportScript(
  doctorImports = OPENARM_HARDWARE_DOCTOR_IMPORTS
) {
  const moduleNames = doctorImports.map(([moduleName]) => moduleName);
  return [
    'import importlib',
    LEROBOT_SOURCE_VERIFY_SCRIPT,
    OPENARM_LEROBOT_COMPATIBILITY_VERIFY_SCRIPT,
    `module_names = ${JSON.stringify(moduleNames)}`,
    'for module_name in module_names:',
    '    importlib.import_module(module_name)',
    'print("openarm hardware runtime ok")',
  ].join('\n');
}

export function buildOpenArmHardwareDoctorScript(
  doctorImports = OPENARM_HARDWARE_DOCTOR_IMPORTS
) {
  return `
import importlib
import json

checks = ${JSON.stringify(doctorImports)}
results = []
for module_name, label in checks:
    try:
        importlib.import_module(module_name)
        ok = True
        error = None
    except Exception as exc:
        ok = False
        error = f"{type(exc).__name__}: {exc}"
    results.append({"module": module_name, "label": label, "ok": ok, "error": error})
print(json.dumps(results))
`;
}
