# Setup

```bash
npm run setup
npm run start
```

Open the URL printed by the launcher, usually:

```text
http://127.0.0.1:5173
```

`npm run setup` installs Node dependencies and a local Python backend environment in `.venv`.

Optional simulator runtimes are not required to load and inspect URDF files. The backend exposes a RoboVerse-compatible target set, then checks at runtime whether each local dependency is available.

Target registry:

- Openable now: Genesis, MuJoCo, PyBullet, Blender.
- Planned transfer adapters: MuJoCo MJX, Isaac Sim, Isaac Lab, Isaac Gym, SAPIEN, CoppeliaSim/PyRep.

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
```

You can install more than one at a time:

```bash
npm run simulator:install -- mujoco pybullet
```

For an existing simulator Python environment, skip installing into `.venv` and point URDF Studio at it:

```bash
URDF_STUDIO_PYTHON=/path/to/python npm run simulator:status
URDF_STUDIO_PYTHON=/path/to/python npm run start
```

Use this for Isaac Sim, Isaac Lab, Isaac Gym, and CoppeliaSim/PyRep environments, because their upstream installers are more specific than a small pip helper should manage.

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
