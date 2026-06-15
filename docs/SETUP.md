# URDF Studio Setup

This guide covers installing and launching URDF Studio. For the product walkthrough, see [User Guide](USER_GUIDE.md).

## Quick Start

```bash
git clone https://github.com/amtellezfernandez/urdf-studio.git
cd urdf-studio
npm run setup
npm run start
```

Open the URL printed in the terminal:

```text
http://127.0.0.1:5173
```

## Prerequisites

- Node.js and npm
- `uv` from <https://astral.sh/uv>. No separate Python install is required; setup creates the Python 3.12 backend/training runtime through `uv`.

On Linux, install build tools before setup:

```bash
sudo apt-get update
sudo apt-get install python3-dev build-essential
```

## Install

```bash
npm run setup
```

Setup installs the app dependencies and local runtime used by URDF Studio. The first run can take several minutes.

Setup also prepares supported workspace transfer targets when the platform packages are available. The base app remains usable if a local target runtime cannot be installed on the current laptop.

Blender layout round-trip sessions use a local Blender runtime. On Linux and WSL x64, setup installs a managed Blender 4.5 LTS runtime under `.cache/blender-runtime` when Blender is not already on PATH. On macOS or Windows, Studio uses the native Blender app/executable; set `URDF_STUDIO_BLENDER_PATH` to a Blender executable, `.app` bundle, or install directory only for custom locations.

Optional setup commands:

```bash
npm run setup:check
npm run setup -- --twin
```

On macOS, setup attempts the app and workspace viewer runtimes. Some optional native training/collision packages are skipped when their wheels are not portable across local Python environments.

## Start Locally

```bash
npm run start
```

Healthy startup prints:

```text
Ready:
Open URDF Studio: http://127.0.0.1:5173
Access: only this laptop.
Sharing: localhost links work only on this computer.
```

Use `npm run start` for demos, verification, and normal work.

## Share On A Trusted Network

For a team demo on the same Wi-Fi, wired LAN, or Tailnet:

```bash
npm run team
```

The launcher prints a Team URL. Open it on the server laptop first, use `Share`, then send the collaboration link to the people who should join.

If the launcher picks the wrong network address:

```bash
npm run team -- --team-host 192.168.1.40
```

Use team mode only on a network you intentionally trust.

## Phone/Data Mode

Phone/data mode can create a public tunnel back to your local machine. Use it only when you intend to expose that workflow:

```bash
npm run data -- --ack-public-tunnel
```

If the tunnel cannot be established, startup fails closed.

## Ports

Use another app port when the default is busy:

```bash
npm run start -- --web-port 3001
```

For all runtime options:

```bash
npm run start -- --help
```

## Commands

| Command | Meaning |
| --- | --- |
| `npm run setup` | Install dependencies and local runtime |
| `npm run start` | Start the local app |
| `npm run team` | Start a trusted-network team session |
| `npm run data` | Start phone/data workflow with tunnel acknowledgement |
| `npm run release:check` | Run release-readiness checks |
| `npm run simulator:workspace:check` | Headlessly prepare the demo workspace in installed transfer targets |
| `npm run simulator:workspace:check:fixtures` | Validate demo, Studio Y-up, and mesh-asset transfer fixtures |
| `npm run simulator:blender:check` | Strictly validate the local Blender runtime and camera renders |
| `npm run simulator:blender:check:fixtures` | Strictly validate Blender across all transfer fixtures |
| `npm run typecheck` | Run TypeScript checks |
| `npm run test` | Run tests |
| `npm run build` | Build production assets |

Validate the Blender transfer contract without requiring Blender to be installed:

```bash
npm run simulator:workspace:check -- blender --artifact-only
```

Validate the local Blender runtime strictly:

```bash
npm run simulator:blender:check
```

Validate the built-in transfer fixture matrix:

```bash
npm run simulator:workspace:check:fixtures
npm run simulator:blender:check:fixtures
```

Validate a specific WSP/URDF package with the same simulator gates:

```bash
npm run simulator:workspace:check -- \
  genesis \
  --world-package path/to/world-package.json \
  --robot-source path/to/robot.urdf-or.xacro \
  --asset-root path/to/asset-root \
  --artifact-only
```

`--asset-root` bundles simulator assets only: mesh files, material/texture sidecars, `package.xml`, and related interchange files. Local notes, logs, caches, and source-control files are ignored.

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

### Setup Seems Stuck

The first setup can take several minutes while native dependencies install. If it fails, rerun:

```bash
npm run setup
```

### The App Does Not Open

Run:

```bash
npm run start
```

Then open the URL printed in the `Ready:` block.

### The UI Opens But Actions Fail

Restart from the launcher:

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

## Auth Tokens

Setup can save local Hugging Face and GitHub access in `.urdf-studio-config.json`, which is gitignored.

Recommended GitHub access order:

1. Use `gh auth login`.
2. Export `GITHUB_TOKEN` or `GH_TOKEN` in your shell.
3. Save a repo-specific token only if you need a fallback.
