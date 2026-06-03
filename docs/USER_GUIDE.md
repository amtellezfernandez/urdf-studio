# URDF Studio User Guide

This guide is the human-facing map for URDF Studio. It explains what to run, what each surface does, and how to tell whether the app is healthy.

## Mental Model

URDF Studio has four local pieces in a normal run:

| Piece | URL | Purpose |
| --- | --- | --- |
| Studio frontend | `http://localhost:5173` | Main robotics workspace |
| Studio backend | `http://localhost:8000` | IK, robot mastering, datasets, health, runtime services |
| URDF Ops frontend | `http://127.0.0.1:5174` | Training and operations workspace |
| URDF Ops backend | `http://127.0.0.1:8001` | URDF Ops API |

`npm run start` launches all of them. `npm run dev` launches only the Studio frontend.

## Visual Walkthrough

The fastest way to understand the product is to load the sample motion and watch how the UI fills in.

<p align="center">
  <img src="assets/quickstart-load.gif" alt="URDF Studio loading the sample robot and episode workspace" width="900">
</p>

The workspace is built for repeated robotics work: a 3D viewer in the center, dataset and playback controls on the left, and scene/joint detail on the right.

<p align="center">
  <img src="assets/workspace-tour.gif" alt="URDF Studio workspace with robot inspection panels and scene controls" width="900">
</p>

Episode replay keeps the robot pose, frame counter, graph cursor, and joint curves synchronized.

<p align="center">
  <img src="assets/episode-replay.gif" alt="URDF Studio episode replay with synchronized graph cursor" width="900">
</p>

When you are ready to move from inspection into training operations, use `URDF Ops` in the top bar.

<p align="center">
  <img src="assets/ops-handoff.gif" alt="URDF Ops training workspace opened from URDF Studio" width="900">
</p>

## First Launch

```bash
cd ~/studio/urdf-studio
npm run setup
npm run start
```

When startup is healthy, the terminal prints:

```text
Ready:
Open URDF Studio: http://localhost:5173
Open URDF Ops: http://127.0.0.1:5174
```

Health checks:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8001/health
```

Expected responses:

```text
{"status":"ok","yourdfpy":true}
{"status":"ok"}
```

## First Smoke Test

1. Open `http://localhost:5173`.
2. Click `Play Sample Motion`.
3. Wait for `lekiwi.urdf loaded`.
4. In the `Episodes` panel, click the play button on episode `1`.
5. Confirm:
   - the play button changes to pause
   - the frame counter advances
   - the robot moves
   - the episode graph cursor moves smoothly

If this works, the viewer, dataset replay, graph overlay, and full-stack launch are usable.

## Workspace Map

### Top Bar

- `File`, `Utils`, `Worlds`, `View`, `Dataset`, `Create`, `IK`: main action menus.
- `URDF Ops`: opens the synchronized training workspace.
- `Sim Prep Review`: shows physics/readiness review state.
- `Cams`, `Leader`, `Follower`: camera and teleoperation setup.
- Share/action icons: session and collaboration controls.

### Left Sidebar

- `Record`: starts recording workflows.
- FPS and target FPS controls: runtime timing controls.
- Dataset policy and limit correction: how imported/replayed data is treated.
- `Playback`: global playback controls.
- `Episodes`: per-episode replay, retake, export, delete, and ordering.
- Replay zero mode: choose target robot zero pose or raw dataset pose.

### Center Viewer

- 3D robot/world view.
- Gizmos, object handles, scene objects, and camera controls.
- `Reset Pose` resets the active robot pose.
- Wheel/drive controls appear when the active robot supports them.

### Episode Graph

- Shows frame/time, effective FPS, selected signals, and replay cursor.
- Velocity/limit markers identify review problems.
- Edit mode exposes timeline and joint-curve editing tools.

### Right Sidebar

- World object list and scene hierarchy.
- Joint/link/object tabs.
- Active selection details.
- Joint values and runtime telemetry when available.

## Core Workflows

### Load A Robot

1. Start the full app with `npm run start`.
2. In the first screen, use `Robot`.
3. Drop or browse for a URDF/Xacro folder, zip, or individual files.
4. Include meshes (`.stl`, `.glb`, `.gltf`, `.obj`, `.dae`) when the URDF references them.
5. Confirm the robot appears in the viewer and the joints list populates.

### Use The Built-In Sample

1. Click `Play Sample Motion`.
2. Use the episode list to play the first or second episode.
3. Watch the graph and 3D robot together. They should stay synchronized.

### Review Dataset Replay

1. Load a dataset or sample motion.
2. Choose replay zero mode:
   - `Target`: apply loaded target robot zero pose.
   - `Raw`: match the dataset visualizer convention.
3. Play one episode.
4. Check:
   - frame counter
   - elapsed time
   - graph cursor
   - velocity/limit markers
   - joint values in the right sidebar

### Open URDF Ops

1. Launch with `npm run start`.
2. Click `URDF Ops` in the top bar.
3. Studio opens or reuses `http://127.0.0.1:5174`.

URDF Ops is a sibling checkout at `../urdf-ops` by default. Override it with:

```bash
URDF_OPS_ROOT=/path/to/urdf-ops npm run start
```

### Work Frontend-Only

Use this only for UI work:

```bash
npm run dev
```

Expected limitation: backend routes can fail because `npm run dev` does not start the Python backend. If you see `/api/version`, `/api/ik/config`, or `/robot-mastering/*` failures while using `npm run dev`, switch to:

```bash
npm run start
```

## Command Reference

| Command | Meaning |
| --- | --- |
| `npm run setup` | Install Studio deps, Python runtime, and URDF Ops deps |
| `npm run start` | Start full local app |
| `npm run data` | Start data/phone workflow with public tunnel acknowledgement |
| `npm run dev` | Start frontend only |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript project check |
| `npm run test` | Vitest suite |
| `npm run build` | Production build |
| `npm run test:backend` | Backend pytest suite |
| `npm run start -- --help` | Runtime options |

## Setup Details

`npm run setup` installs the local runtime in this repo:

- `node_modules`
- `.venv-lerobot`
- local `i-love-urdf` CLI through `npx ilu`
- optional global `ilu` when requested
- sibling `../urdf-ops` checkout and dependencies

URDF Ops setup is controlled by:

```bash
URDF_OPS_ROOT=/path/to/urdf-ops
URDF_STUDIO_SKIP_URDF_OPS_SETUP=1
```

If URDF Ops dependencies are already installed, setup should say:

```text
URDF Ops dependencies already installed
```

If they are missing, setup prints the npm command and streams install output.

## Troubleshooting

### Setup Looks Stuck At URDF Ops

Check whether `../urdf-ops` exists:

```bash
ls -la ../urdf-ops
test -d ../urdf-ops/node_modules && echo deps-present
```

If dependencies are present, rerun setup. It should skip the install.

If you need to continue without URDF Ops setup:

```bash
URDF_STUDIO_SKIP_URDF_OPS_SETUP=1 npm run setup
```

### Backend Setup Or Collision Imports Fail

Run setup again before launching:

```bash
npm run setup
```

Setup repairs the pinned native collision runtime used by OpenArm self-collision checks. For details, see [Setup](SETUP.md).

### Frontend Opens But API Calls Fail

You likely ran `npm run dev`. Start the full stack:

```bash
npm run start
```

Then verify:

```bash
curl http://127.0.0.1:8000/health
```

### URDF Ops Does Not Open

Check:

```bash
curl http://127.0.0.1:8001/health
curl -I http://127.0.0.1:5174
```

If another process owns the ports, override them:

```bash
URDF_OPS_WEB_PORT=5176 URDF_OPS_API_PORT=8003 npm run start
```

### Port 5173 Is Busy

Use another frontend port:

```bash
npm run start -- --web-port 3001
```

### Sample Loads But Replay Does Not Move

Check the basics:

- Use `npm run start`, not `npm run dev`.
- Confirm the first episode button changes to pause.
- Confirm frame counters advance.
- Open browser devtools and look for page errors.
- Re-run the smoke test after refreshing the page.

## Local Files To Know

| Path | Meaning |
| --- | --- |
| `.venv-lerobot/` | Studio Python runtime |
| `../urdf-ops/` | Sibling URDF Ops checkout |
| `.urdf-studio-config.json` | Local auth/config, gitignored |
| `config/app.config.json` | App runtime config |
| `web/src/` | Studio frontend source |
| `backend/` | Studio backend source |
| `tools/scripts/run.js` | Full-stack launcher |
| `tools/scripts/setup.js` | Setup installer |

## Good Defaults

- Use `npm run start` for demos, verification, and real work.
- Use `npm run dev` only for frontend-only development.
- Keep URDF Ops as the sibling checkout unless you have a reason to override it.
- Keep remote binding disabled unless you are intentionally sharing on a trusted network.
- Use the sample motion as the first regression check after playback changes.
