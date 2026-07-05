# URDF Studio

URDF Studio is a simulator-transfer workbench: author or import a robot-world scene once, then open and validate that same scene in external targets such as Genesis, MuJoCo, PyBullet, and Blender.

One command opens the app. The launcher manages the supporting local services for you.

## See It First

<p align="center">
  <img src="docs/assets/quickstart-load.gif" alt="URDF Studio loading the built-in sample motion into the robotics workspace" width="900">
</p>

One click loads a sample robot, scene objects, cameras, and sample motion for a quick workspace check.

<p align="center">
  <img src="docs/assets/workspace-tour.gif" alt="URDF Studio 3D workspace with robot, joints, scene objects, cameras, and simulator transfer controls" width="900">
</p>

Use the workspace to inspect joints, links, cameras, scene objects, and prepared simulator targets in one dense desktop surface.

## Start Here

```bash
git clone https://github.com/amtellezfernandez/urdf-studio.git
cd urdf-studio
npm run setup
npm run start
```

Open:

```text
http://127.0.0.1:5173
```

Use `npm run start` for demos, verification, and normal work.

## What Should Happen

After `npm run start`, the terminal prints a `Ready:` block like:

```text
Ready:
Open URDF Studio: http://127.0.0.1:5173
Access: only this laptop.
Sharing: localhost links work only on this computer.
```

Fast smoke test:

1. Open `http://127.0.0.1:5173`.
2. Click `Play Sample Motion`.
3. The robot pose, joint values, velocity fields, and camera list should update without UI freezes.
4. Open `Simulation Prep` and check that compatible targets report the expected prepared file type.

## Prerequisites

- Node.js and npm
- `uv` from <https://astral.sh/uv>. No separate Python install is required; setup creates the Python 3.12 backend runtime through `uv`.
- Linux build tools for native Python dependencies:

```bash
sudo apt-get update
sudo apt-get install python3-dev build-essential
```

On macOS, setup attempts the app and workspace viewer runtimes. Some optional native collision and simulation packages are skipped when their wheels are not portable across local Python environments.

## Setup

```bash
npm run setup
```

Setup installs the app dependencies and local runtime used by URDF Studio. It can take a while the first time.

By default, `npm run setup` installs the app dependencies, the unified Python runtime, backend packages, and MJLab when compatible.

Blender, Genesis, PyBullet, and simulator containers are optional and are not installed unless you explicitly opt in. The base app remains usable if an optional target runtime is absent on the current laptop.

During setup, `npm` and `uv` stream live output in the terminal so long installs do not look stalled.

Blender layout round-trip sessions use a local Blender runtime. Set `URDF_STUDIO_INSTALL_BLENDER=1` when running setup to install the managed Blender 4.5 LTS runtime under `.cache/blender-runtime` on Linux and WSL x64. On macOS or Windows, Studio uses the native Blender app/executable; set `URDF_STUDIO_BLENDER_PATH` to a Blender executable, `.app` bundle, or install directory.

Useful setup commands:

```bash
npm run setup:check
npm run setup -- --twin
```

Optional simulator installs:

```bash
URDF_STUDIO_INSTALL_GENESIS=1 npm run setup
URDF_STUDIO_INSTALL_PYBULLET=1 npm run setup
URDF_STUDIO_BUILD_SIMULATOR_CONTAINERS=1 npm run setup
```

Direct manual installs into the managed Python environment:

```bash
uv pip install --python .venv/bin/python3 genesis-world==1.1.0 imgui-bundle==1.92.801 "torch>=2.8"
uv pip install --python .venv/bin/python3 pybullet
```

Default `npm run setup` install inventory:

- `node_modules` for the web app and local tooling
- `.venv` with the unified Python runtime used by backend services
- Backend Python packages required by URDF Studio
- MJLab when the current machine is compatible

Not installed by default:

- Blender runtime
- Genesis
- PyBullet
- Simulator container images
- Every simulator globally

## WSL2 Simulator Setup

Use WSL2, not WSL1. The core app, URDF loading, PyBullet, MuJoCo, MJLab, Genesis, MJX containers, and managed Blender are the supported WSL path when the host has the required display, GPU, and Docker features. Setup detects the machine first and installs only the default managed runtimes unless you explicitly opt into more with flags such as `URDF_STUDIO_INSTALL_BLENDER=1`.

Before installing heavy simulator runtimes, check the basics inside WSL:

```bash
nvidia-smi
docker version
npm run simulator:compatibility
npm run setup:check
```

If you want GPU-accelerated simulator containers, Docker must be available inside WSL and the NVIDIA container runtime must work:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

WSL target behavior:

- Genesis uses CUDA when `nvidia-smi` and `libcuda` are visible; otherwise it falls back to CPU. For interactive workspace opens, Genesis performance mode is off by default to avoid slow static-shape recompilation on every scene change; set `URDF_STUDIO_GENESIS_PERFORMANCE_MODE=1` only for long fixed-scene runs.
- PyBullet uses the WSLg D3D12 OpenGL path when `/dev/dxg`, the Mesa `d3d12` driver, and `/usr/lib/wsl/lib` are available. If a launch warning reports `llvmpipe`, PyBullet is on software OpenGL and mouse/camera interaction can be slow; use MuJoCo or Genesis until the WSL graphics stack is fixed.
- MuJoCo and MJLab use the desktop OpenGL path when WSLg/display is available, EGL when a headless NVIDIA GPU path is available, and OSMesa as the CPU fallback.
- MJX uses a Docker fast path when Docker and the NVIDIA runtime are available. Inspect it with `npm run simulator:container:build -- mjx --print` and `npm run simulator:container:plan -- mjx --workspace <workspace-dir>`.
- Blender uses a managed Linux runtime in WSL x64 when Blender is not already installed.
- Isaac Sim is intentionally blocked inside WSL. Use native Linux with the official NVIDIA workflow, or an official Isaac Sim container on a compatible native Linux GPU host.
- SAPIEN Vulkan rendering is intentionally blocked inside WSL. Use a native Linux GPU host with a Vulkan render device.

Do not install every simulator globally. Run `npm run setup` and let URDF Studio install the default managed runtimes for the current machine. Add Blender or other simulator runtimes only when you need them. Use `npm run simulator:container:plan -- <simulator-id>` to see the exact Docker command for simulator targets that should run in a container.

To inspect one simulator target before installing or launching it:

```bash
npm run simulator:compatibility -- genesis
npm run simulator:compatibility -- mjx
```

To prebuild every compatible managed simulator container for the current machine:

```bash
npm run simulator:container:build -- all --print
npm run simulator:container:build -- all
npm run simulator:container:plan -- all --workspace <workspace-dir>
```

## Run Modes

| Command | Use For |
| --- | --- |
| `npm run start` | Normal local app |
| `npm run team` | Intentional same-Wi-Fi or Tailnet sharing |
| `npm run start -- --help` | Runtime options |

Use `npm run start` when you want the real app.

## Common Workflows

### Load The Sample Motion

1. Start the app with `npm run start`.
2. Click `Play Sample Motion`.
3. Inspect the joint tree, velocity/effort fields, cameras, and scene objects.

### Load Your Own Robot

1. Use the `Robot` loader on the first screen.
2. Drop a URDF/Xacro folder, zip, or files with meshes.
3. Check the scene tree and joints panel after load.
4. Use `Reset Pose`, joint controls, and simulator preparation tools to inspect behavior.

### Prepare A Simulator Workspace

1. Load a robot-world scene.
2. Open `Simulation Prep`.
3. Pick a compatible target such as Blender, PyBullet, MuJoCo, MJLab, or Genesis.
4. Review whether the target uses URDF directly or needs a converted workspace file.

## Sharing

Local start is private to your laptop. For a shared demo or team session:

```bash
npm run team
```

Open the printed Team URL on the server laptop, use `Share`, then send the collaboration link to the people who should join. Use sharing only on a network you trust.

## Troubleshooting

### Setup Fails Creating Python 3.12

Use `uv` to install Python 3.12, then rerun setup:

```bash
uv python install 3.12
npm run setup
```

Advanced: point setup at a specific interpreter instead of the `uv` managed one:

```bash
URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON=/path/to/python3.12 npm run setup
```

### The App Does Not Open

Run:

```bash
npm run start
```

Then use the URL printed in the `Ready:` block.

### Port 5173 Is Busy

Use another app port:

```bash
npm run start -- --web-port 3001
```

### The UI Opens But Actions Fail

Restart from the launcher:

```bash
npm run start
```

### Sample Motion Does Not Move

- Use `npm run start`.
- Confirm `Play Sample Motion` toggles to pause.
- Confirm joint angle and velocity values update.
- Refresh the page and repeat the smoke test.

## Security Defaults

`npm run start` is local-only by default.

For collaboration, prefer:

```bash
npm run team
```

Advanced network options are available through `npm run start -- --help`, but normal sharing should use `npm run team`.

## Documentation

- [User Guide](docs/USER_GUIDE.md) - first launch, UI map, workflows, and troubleshooting.
- [Setup Guide](docs/SETUP.md) - installation, launch modes, sharing, and runtime checks.
- [Documentation Index](docs/README.md) - advanced operation guides and public file/session specs.

## Developer Checks

```bash
npm run release:check
npm run simulator:workspace:check:fixtures
npm run simulator:blender:check:fixtures
npm run lint
npm run typecheck
npm run test
npm run build
```

## License And Contributions

- License: see [LICENSE](LICENSE)
- Contributions require written permission and a CLA: see [CLA.md](CLA.md)
- Contributing guidelines: see [CONTRIBUTING.md](CONTRIBUTING.md)
