# URDF Studio

URDF Studio is a local robotics workspace for loading URDF robots, inspecting scene structure, editing joints and keyframes, and replaying robot-learning episodes.

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
cd ~/studio/urdf-studio
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
- Python 3
- `uv` from <https://astral.sh/uv>
- Linux build tools for native Python dependencies:

```bash
sudo apt-get update
sudo apt-get install python3-dev build-essential
```

On macOS, setup skips optional native collision checks by default because those libraries are less portable across local Python environments.

## Setup

```bash
npm run setup
```

Setup installs the app dependencies and local runtime used by URDF Studio. It can take a while the first time.

Useful setup options:

```bash
npm run setup -- --install-global-ilu
npm run setup -- --twin
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

### Replay Or Review Episodes

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
npm run lint
npm run typecheck
npm run test
npm run build
```

## License And Contributions

- License: see [LICENSE](LICENSE)
- Contributions require written permission and a CLA: see [CLA.md](CLA.md)
- Contributing guidelines: see [CONTRIBUTING.md](CONTRIBUTING.md)
