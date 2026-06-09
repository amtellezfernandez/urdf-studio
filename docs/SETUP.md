# URDF Studio Setup

This guide covers installing and launching URDF Studio. For the product walkthrough, see [User Guide](USER_GUIDE.md).

## Quick Start

```bash
cd ~/studio/urdf-studio
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

Optional setup commands:

```bash
npm run setup -- --install-global-ilu
npm run setup -- --twin
```

On macOS, setup skips optional native collision checks by default. Force them only if you know you need them:

```bash
URDF_STUDIO_INSTALL_COLLISION_STACK=1 npm run setup
```

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
| `npm run typecheck` | Run TypeScript checks |
| `npm run test` | Run tests |
| `npm run build` | Build production assets |

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
