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

Optional simulator runtimes are not required to load and inspect URDF files. The backend exposes Genesis, MuJoCo, PyBullet, and Blender transfer targets, then checks at runtime whether each local dependency is available.

Check what this machine already has:

```bash
npm run simulator:status
```

Install only the Python simulators you want in the local `.venv`:

```bash
npm run simulator:install -- mujoco
npm run simulator:install -- pybullet
npm run simulator:install -- genesis
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
