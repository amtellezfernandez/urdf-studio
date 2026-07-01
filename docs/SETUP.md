# Setup

```bash
npm run setup
npm run start
```

Open the URL printed by the launcher, usually:

```text
http://127.0.0.1:5173
```

In hosted or port-forwarded workspaces, use the forwarded port `5173` URL or one of the Vite `Network` URLs printed by `npm run start`.

`npm run setup` installs Node dependencies and a local Python backend environment in `.venv`.

Optional simulator runtimes are not required to load and inspect URDF files. The backend exposes a RoboVerse-compatible target set, then checks at runtime whether each local dependency is available.

Target registry:

- Openable now: Genesis, MuJoCo, MuJoCo MJX, Newton, PyBullet, Isaac Sim, Isaac Lab, Isaac Gym, SAPIEN, CoppeliaSim, Blender.
- Planned transfer adapters: none. Optional runtimes are runtime-gated by installed packages, external apps, and required license acknowledgement.

Check what this machine already has:

```bash
npm run simulator:status
```

Install only the Python simulators you want in the local `.venv`:

```bash
npm run simulator:install -- mujoco
npm run simulator:install -- pybullet
npm run simulator:install -- genesis
npm run simulator:install -- sapien
npm run simulator:install -- mjx
npm run simulator:install -- newton
```

You can install more than one at a time:

```bash
npm run simulator:install -- mujoco pybullet
```

Install every pip-installable target:

```bash
npm run simulator:install -- all
```

When Isaac Sim or Isaac Lab is selected, the installer uses `.venv-sim311` because Isaac Sim 5.x requires Python 3.11. Run with that environment when validating Isaac packages:

```bash
URDF_STUDIO_PYTHON=.venv-sim311/bin/python3 npm run simulator:status
```

For an existing simulator Python environment, skip installing into `.venv` and point URDF Studio at it:

```bash
URDF_STUDIO_PYTHON=/path/to/python npm run simulator:status
URDF_STUDIO_PYTHON=/path/to/python npm run start
```

Use this for manually managed simulator environments, especially Isaac Gym and custom CoppeliaSim installations.

CoppeliaSim requires the pip-installable ZMQ remote API client plus the external CoppeliaSim application. After installing CoppeliaSim, set one of:

```bash
URDF_STUDIO_COPPELIASIM_PATH=/path/to/coppeliaSim.sh
COPPELIASIM_ROOT=/path/to/CoppeliaSim
```

For Isaac Sim or Isaac Lab, NVIDIA requires accepting the Omniverse EULA before first runtime use. After you have accepted it, set:

```bash
OMNI_KIT_ACCEPT_EULA=YES
```

Isaac Gym is not published as a normal package on the Python registry. Install it from NVIDIA's legacy Isaac Gym distribution, then run URDF Studio with `URDF_STUDIO_PYTHON` pointing at that environment.

Blender is detected as an external application, not installed as a Python package. If it is not on `PATH`, set:

```bash
URDF_STUDIO_BLENDER_PATH=/path/to/blender npm run simulator:status
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:backend
npm run simulator:workspace:check:fixtures
```

`simulator:workspace:check:fixtures` validates every installed runtime and skips missing optional runtimes. On a machine where all simulator runtimes are installed, run the strict check:

```bash
npm run simulator:workspace:check:fixtures:strict
```
