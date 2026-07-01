# URDF Studio

URDF Studio is a local workbench for loading URDF/Xacro robots, inspecting joints and links, and opening the same robot-world scene in simulator targets.

First release scope:

- Load URDF or Xacro files with mesh assets.
- Move model joints in the browser viewer.
- Add simple boxes and cameras to a scene.
- Transfer the workspace to Genesis, MuJoCo, PyBullet, or Blender.

Not included in this branch: teleoperation, robot hardware control, episodes, datasets, ROS visualization, collaboration, or LeRobot-specific workflows.

## Start

```bash
npm run setup
npm run start
```

Open the URL printed by the launcher, usually:

```text
http://127.0.0.1:5173
```

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm run test:backend
```

Simulator runtimes are optional local dependencies. Check what is already installed:

```bash
npm run simulator:status
```

Install only the Python targets you want:

```bash
npm run simulator:install -- mujoco pybullet
```

Use `URDF_STUDIO_PYTHON=/path/to/python` for an existing simulator environment. Use `URDF_STUDIO_BLENDER_PATH=/path/to/blender` when Blender is installed outside standard paths.

Simulator fixture checks skip missing optional runtimes by default:

```bash
npm run simulator:workspace:check:fixtures
```

On a release machine with every runtime installed:

```bash
npm run simulator:workspace:check:fixtures:strict
```

## Docs

- [Setup](docs/SETUP.md)
- [World Scene Package](docs/specs/WSP_v1.md)

## License

See [LICENSE](LICENSE).
