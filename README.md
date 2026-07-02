# URDF Studio

URDF Studio is a simulator-transfer workbench: author or import a robot-world scene once, then open and validate that same scene in external targets such as Genesis, MuJoCo, PyBullet, and Blender.

One command opens the app. The launcher manages the supporting local services for you.

## See It First

<p align="center">
  <img src="docs/assets/quickstart-load.gif" alt="URDF Studio loading the built-in sample motion into the robotics workspace" width="900">
</p>

One click loads a sample robot, scene objects, cameras, and replayable episodes.

<table>
  <tr>
    <td width="50%">
      <strong>Robotics Workspace</strong><br>
      Inspect the robot, joints, links, cameras, scene objects, and world context in one dense desktop surface.<br><br>
      <img src="docs/assets/workspace-tour.gif" alt="URDF Studio 3D workspace with robot, joints, scene objects, and side panels" width="100%">
    </td>
    <td width="50%">
      <strong>Episode Replay</strong><br>
      Play episodes, watch the robot move, and review the synchronized joint graph and replay cursor.<br><br>
      <img src="docs/assets/episode-replay.gif" alt="URDF Studio replaying an episode with the graph cursor and robot motion synchronized" width="100%">
    </td>
  </tr>
</table>

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
3. In `Episodes`, click the first episode play button once.
4. The button should change to pause, the frame counter should advance, and the graph cursor should move smoothly.

## Prerequisites

- Node.js and npm
- `uv` from <https://astral.sh/uv>. No separate Python install is required; setup creates the Python 3.12 backend/training runtime through `uv`.
- Linux build tools for native Python dependencies:

```bash
sudo apt-get update
sudo apt-get install python3-dev build-essential
```

On macOS, setup attempts the app and workspace viewer runtimes. Some optional native training/collision packages are skipped when their wheels are not portable across local Python environments.

## Setup

```bash
npm run setup
```

Setup installs the app dependencies and local runtime used by URDF Studio. It can take a while the first time.

Setup also prepares supported workspace transfer targets when the platform packages are available. The base app remains usable if a local target runtime cannot be installed on the current laptop.

Blender layout round-trip sessions use a local Blender runtime. On Linux and WSL x64, setup installs a managed Blender 4.5 LTS runtime under `.cache/blender-runtime` when Blender is not already on PATH. On macOS or Windows, Studio uses the native Blender app/executable; set `URDF_STUDIO_BLENDER_PATH` to a Blender executable, `.app` bundle, or install directory only for custom locations.

Useful setup commands:

```bash
npm run setup:check
npm run setup -- --twin
```

## WSL2 Simulator Setup

Use WSL2, not WSL1. The core app, URDF loading, PyBullet, MuJoCo, MJLab, Genesis, MJX containers, and managed Blender are the supported WSL path when the host has the required display, GPU, and Docker features. Setup detects the machine first and skips or blocks simulator runtimes that are not a good match for the laptop.

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
- MuJoCo and MJLab use the desktop OpenGL path when WSLg/display is available, EGL when a headless NVIDIA GPU path is available, and OSMesa as the CPU fallback.
- MJX uses a Docker fast path when Docker and the NVIDIA runtime are available. Inspect it with `npm run simulator:container:build -- mjx --print` and `npm run simulator:container:plan -- mjx --workspace <workspace-dir>`.
- Blender uses a managed Linux runtime in WSL x64 when Blender is not already installed.
- Isaac Sim is intentionally blocked inside WSL. Use native Linux with the official NVIDIA workflow, or an official Isaac Sim container on a compatible native Linux GPU host.
- SAPIEN Vulkan rendering is intentionally blocked inside WSL. Use a native Linux GPU host with a Vulkan render device.

Do not install every simulator globally. Run `npm run setup` and let URDF Studio choose the managed native runtimes for the current machine. Use `npm run simulator:container:plan -- <simulator-id>` to see the exact Docker command for simulator targets that should run in a container.

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
| `npm run data` | Phone/data workflow with explicit tunnel acknowledgement |
| `npm run start -- --help` | Runtime options |

Use `npm run start` when you want the real app.

## Common Workflows

### Load The Sample Motion

1. Start the app with `npm run start`.
2. Click `Play Sample Motion`.
3. Use the `Episodes` panel to replay the sample trajectories.

### Load Your Own Robot

1. Use the `Robot` loader on the first screen.
2. Drop a URDF/Xacro folder, zip, or files with meshes.
3. Check the scene tree and joints panel after load.
4. Use `Reset Pose`, joint controls, and replay tools to inspect behavior.

### Replay Episodes

1. Load or record episodes.
2. Use the left `Episodes` list to choose an episode.
3. Use the inline episode graph to inspect frame, time, joint curves, and velocity/limit markers.
4. Use one-click play/pause to verify replay motion.

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
URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON=/path/to/python3.12 npm run setup
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

### Sample Loads But Replay Does Not Move

- Use `npm run start`.
- Confirm the first episode button changes to pause.
- Confirm frame counters advance.
- Refresh the page and repeat the smoke test.

## Security Defaults

`npm run start` is local-only by default.

For collaboration, prefer:

```bash
npm run team
```

Advanced network options are available through `npm run start -- --help`, but normal sharing should use `npm run team`.

Phone/data mode also requires explicit acknowledgement:

```bash
npm run data -- --ack-public-tunnel
```

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
