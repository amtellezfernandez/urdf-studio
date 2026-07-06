# URDF Studio User Guide

This guide explains how to launch URDF Studio, use the main workspace, and troubleshoot common user-facing problems.

## Mental Model

URDF Studio is a local robotics workspace and transfer workbench. Start it with one command, load or author a robot-world scene once, then use `Simulation Prep` to move that scene into validated external targets such as Genesis, MuJoCo, PyBullet, or Blender.

The launcher manages the supporting local services for you. In normal use, you only need the Studio URL printed in the terminal.

## Visual Walkthrough

The fastest way to understand the product is to load the sample motion and watch how the UI fills in.

<p align="center">
  <img src="assets/quickstart-load.gif" alt="URDF Studio loading the sample robot workspace" width="900">
</p>

The workspace is built for repeated robotics work: a 3D viewer in the center, focused inspection controls around it, and scene/joint/simulator detail in the sidebars.

<p align="center">
  <img src="assets/workspace-tour.gif" alt="URDF Studio workspace with robot inspection panels and scene controls" width="900">
</p>

Use the sample motion as a quick health check: the robot pose, joint values, velocity fields, scene tree, and camera list should update together.

## First Launch

```bash
git clone https://github.com/amtellezfernandez/urdf-studio.git
cd urdf-studio
npm run setup
npm run start
```

When startup is healthy, the terminal prints:

```text
Ready:
Open URDF Studio: http://127.0.0.1:5173
Access: only this laptop.
Sharing: localhost links work only on this computer.
```

Open the Studio URL in your browser.

## First Smoke Test

1. Open `http://127.0.0.1:5173`.
2. Click `Play Sample Motion`.
3. Wait for the sample robot to load.
4. Confirm:
   - the play button changes to pause
   - the robot moves
   - joint angle and velocity values update
   - cameras appear in the camera list
5. Open `Simulation Prep` and confirm compatible targets show a prepared file type.

If this works, the viewer, joint state pipeline, camera panel, simulator preparation, and local launch are usable.

## Workspace Map

### Top Bar

- `File`, `Utils`, `Scene`, `View`, and `Create`: main action menus.
- `Simulation Prep`: inspect and open the current robot-world scene in validated transfer targets.
- Camera controls: inspect and manage scene cameras.
- Share/action icons: session and collaboration controls.

### Left Sidebar

- Camera list and camera view controls.
- Sample motion playback state.
- Scene helper controls that need quick access while inspecting the 3D view.

### Center Viewer

- 3D robot/world view.
- Gizmos, object handles, scene objects, and camera controls.
- `Reset Pose` resets the active robot pose.
- Wheel/drive controls appear when the active robot supports them.

### Right Sidebar

- World object list and scene hierarchy.
- Joint/link/object tabs.
- Active selection details.
- Joint values, velocity, effort, limits, and runtime telemetry when available.
- Simulator targets and workspace preparation status.

## Core Workflows

### Load A Robot

1. Start the app with `npm run start`.
2. In the first screen, use `Robot`.
3. Choose one source:
   - Local files, folder, or zip containing a URDF/Xacro and meshes.
   - A GitHub repository URL plus an optional URDF/Xacro path.
   - A direct URDF/Xacro URL, including GitHub `blob` links.
4. Include meshes (`.stl`, `.glb`, `.gltf`, `.obj`, `.dae`) when the URDF references them.
5. Confirm the robot appears in the viewer and the joints list populates.

Useful SO-ARM100 direct links:

- SO101 new calibration: `https://github.com/TheRobotStudio/SO-ARM100/blob/main/Simulation/SO101/so101_new_calib.urdf`
- SO101 old calibration: `https://github.com/TheRobotStudio/SO-ARM100/blob/main/Simulation/SO101/so101_old_calib.urdf`
- SO100: `https://github.com/TheRobotStudio/SO-ARM100/blob/main/Simulation/SO100/so100.urdf`

### Import A World

World documents are the authored scene format. They can contain world objects only, or the same
objects plus embedded robot state (`urdf_xml`, `joint_positions`, `cameras`) and environment
metadata.

From the first screen:

1. Use `World`.
2. Choose one source:
   - `From Link` for a public JSON link or GitHub `blob` link.
   - `Local Files` for one JSON plus any referenced assets.
   - `Local Folder` for a folder containing the JSON and its referenced assets.
3. Load the workspace once the layout is staged.

From the workspace:

1. Use `Scene` -> `Import Layout JSON`.
2. Choose `From Link` for a public JSON link or GitHub `blob` link.
3. `Default Layout` and `Demo Layout` are available from the same dialog when applicable.

Relative asset refs resolve against the loaded file set or the source URL. No asset upload step is
required.

### Import Or Export A Registry Package

Registry packages wrap the same world document in a thin envelope with `package_id`, `version`,
`provenance`, and `artifacts`. Use them when publishing, downloading a package file, or loading
from the registry.

- Export package file: `Scene` -> `Export Scene Package`.
- Import local JSON: `Scene` -> `Import Scene Package` -> `From File`.
- Browse registry packages: `Scene` -> `Browse Scene Packages`.
- Export world document: `Scene` -> `Export World Layout`. You can include or omit robot state.

### Use The Built-In Sample

1. Click `Play Sample Motion`.
2. Inspect the joint tree, velocity/effort fields, cameras, and scene objects.
3. Open `Simulation Prep` to check which targets are ready on the current machine.

### Export Robot Files

Use `File` -> `Export` to write URDF, Xacro, MJCF, USD, meshes, and camera configs. When a simulator or interchange conversion reports dropped geometry, repaired inertials, or other transfer warnings, Studio writes a matching `*.diagnostics.json` file next to the exported simulator file.

### Edit A Layout In Blender

1. Open `Simulation Prep` and click `Blender`.
2. In Blender, use the locked robot visual reference and edit world object transforms and dimensions.
3. Run the generated `export_blender_changes.py` script from that Blender session.
4. Back in Studio, use `Scene` -> `Import Workspace Changes` and select `blender-change-set.json`.

Studio writes `robot-reference.glb` for Blender-native robot visuals and `robot-reference.usda` for interchange metadata. Studio applies validated world object transforms, dimensions, display colors, camera poses, camera FOV, new Blender objects, and deleted source objects/cameras from the same source scene. New Blender mesh objects import as Studio mesh world objects when they carry a portable relative `asset_ref`; otherwise they import as colored cube world objects. Robot kinematics, inertials, collisions, transmissions, material-domain edits, and mesh-domain edits stay under Studio review.

### Prepare A Simulator Workspace

1. Load a robot-world scene.
2. Open `Simulation Prep`.
3. Choose a compatible target such as Blender, PyBullet, MuJoCo, MJLab, or Genesis.
4. Review whether the target uses URDF directly or needs a converted workspace file.
5. Open the target or run the generated workspace check command when validating a machine.

### Share A Session

For same-network collaboration:

```bash
npm run team
```

Open the printed Team URL on the server laptop first. Use `Share` in the top bar, then send the generated collaboration link to the people who should join.

Use Share again to pause sharing, reset links, or change access.

## Command Reference

| Command | Meaning |
| --- | --- |
| `npm run setup` | Install dependencies and local runtime |
| `npm run start` | Start the local app |
| `npm run team` | Start a trusted-network team session |
| `npm run start -- --help` | Runtime options |

## Troubleshooting

### The App Does Not Open

Run:

```bash
npm run start
```

Then open the URL printed in the `Ready:` block.

### The UI Opens But Actions Fail

Start the app again from the launcher:

```bash
npm run start
```

### Port 5173 Is Busy

Use another app port:

```bash
npm run start -- --web-port 3001
```

### Teammates Cannot Connect

- Confirm everyone is on the same Wi-Fi/LAN/Tailnet.
- Confirm the Team URL uses the server laptop network address, not `localhost`.
- Retry with `npm run team -- --team-host <server-laptop-ip>`.
- Check local firewall prompts for Node.

### Sample Motion Does Not Move

- Use `npm run start`.
- Confirm `Play Sample Motion` toggles to pause.
- Confirm joint angle and velocity values update.
- Refresh the page and repeat the smoke test.

## Good Defaults

- Use `npm run start` for demos, verification, and real work.
- Keep remote sharing off unless you are intentionally sharing on a trusted network.
- Use the sample motion and simulator preparation panel as the first regression check after workspace changes.
