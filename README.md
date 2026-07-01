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

Simulator fixture checks:

```bash
npm run simulator:workspace:check:fixtures
```

## Docs

- [Setup](docs/SETUP.md)
- [World Scene Package](docs/specs/WSP_v1.md)

## License

See [LICENSE](LICENSE).
