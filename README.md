# URDF Studio

URDF Studio is a local workbench for loading URDF/Xacro robots, inspecting joints and links, and opening the same robot-world scene in simulator targets.

First release scope:

- Load URDF or Xacro files with mesh assets.
- Move model joints in the browser viewer.
- Add simple boxes and cameras to a scene.
- Transfer the workspace to openable simulator targets.
- Track the RoboVerse-compatible simulator set: Genesis, MuJoCo, MuJoCo MJX, Newton, PyBullet, Isaac Sim, Isaac Lab, Isaac Gym, SAPIEN, CoppeliaSim, and Blender.

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

In hosted or port-forwarded workspaces, use the forwarded port `5173` URL or one of the Vite `Network` URLs printed by `npm run start`.

`npm run start` serves the built clean app with the local backend proxy. Use `npm run dev` only when actively editing the frontend.

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
npm run simulator:install -- all
```

Use `URDF_STUDIO_PYTHON=/path/to/python` for an existing simulator environment. Use `URDF_STUDIO_BLENDER_PATH=/path/to/blender` when Blender is installed outside standard paths.

Isaac Sim/Lab use a Python 3.11 simulator environment (`.venv-sim311`) and require NVIDIA Omniverse EULA acceptance before first runtime use. Isaac Gym still requires NVIDIA's legacy Isaac Gym distribution.

Openable targets in this clean release are Genesis, MuJoCo, MuJoCo MJX, Newton, PyBullet, Isaac Sim, Isaac Lab, Isaac Gym, SAPIEN, CoppeliaSim, and Blender. MJX, Newton, and SAPIEN use headless physics-only openers in this branch. Isaac Sim/Lab require Python 3.11 and explicit Omniverse EULA acceptance before runtime use. CoppeliaSim uses the ZMQ remote API and requires a separately installed CoppeliaSim app. Isaac Gym is runtime-gated behind NVIDIA's legacy Isaac Gym distribution.

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
