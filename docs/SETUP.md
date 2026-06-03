# URDF Studio Setup

This is the detailed setup and launch guide. For the product/UI walkthrough, see [User Guide](USER_GUIDE.md).

## Quick Start

### 1. Run Setup
```bash
cd ~/studio/urdf-studio
npm run setup
```

This will:
- Show the setup roadmap.
- Install URDF Studio npm dependencies.
- Set up the unified Python environment at `.venv-lerobot` with backend, Placo, LeRobot training, OpenArm hardware, MJLab, MuJoCo-Warp, and the MJX system-identification runtime
- Provision the sibling URDF Ops checkout at `../urdf-ops` unless skipped or overridden.
- Install URDF Ops npm dependencies when they are missing.
- Prompt you to configure HuggingFace authentication.
- Prompt you to configure GitHub access.
- Install the local `i-love-urdf` CLI for this repo (`npx ilu`).

Setup pins MuJoCo-Warp to the release that imports cleanly with the installed MuJoCo runtime.

### URDF Ops workspace setup

URDF Ops is the synchronized training/operations workspace that opens from the `UrdfOps` top-bar button. By default, setup uses a sibling checkout:

```text
~/studio/urdf-studio
~/studio/urdf-ops
```

Override the checkout:

```bash
URDF_OPS_ROOT=/path/to/urdf-ops npm run setup
```

Skip URDF Ops setup temporarily:

```bash
URDF_STUDIO_SKIP_URDF_OPS_SETUP=1 npm run setup
```

If `../urdf-ops/node_modules/.bin/vite` already exists, setup prints:

```text
URDF Ops dependencies already installed
```

If dependencies are missing, setup prints the npm command it is running and streams the install output. This prevents the URDF Ops step from looking frozen.

### Install the `ilu` CLI globally too

URDF Studio works without a global `ilu` install. If you want `ilu` on your shell `PATH` everywhere, run:

```bash
cd ~/studio/urdf-studio
npm run setup -- --install-global-ilu
```

The setup script will install the exact `i-love-urdf` package version already installed in this repo.

### Enable VGGT ("twin") dependencies

This clones `facebookresearch/vggt` into `./vggt/` and installs its Python requirements into `./.venv-lerobot/`.

```bash
cd ~/studio/urdf-studio
npm run setup -- --twin
```

Or, if you prefer to do it during `npm install`:

```bash
cd ~/studio/urdf-studio
npm install --twin
npm run setup
```

### 2. Start URDF Studio
```bash
cd ~/studio/urdf-studio
npm run start
```

This will start:
- **Frontend**: `http://localhost:5173` (Vite + React)
- **Backend API**: `http://localhost:8000` (FastAPI + Python)
- **URDF Ops frontend**: `http://127.0.0.1:5174`
- **URDF Ops API**: `http://127.0.0.1:8001`

`npm run start` is the safe local default and keeps binds on loopback unless you override them explicitly.
It also checks the official `origin/main` branch and refuses to start stale checkouts until you update them.

Healthy startup prints a `Ready:` block with the Studio and Ops URLs. Verify both backends with:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8001/health
```

Use `npm run start` for demos, verification, and normal work. Use `npm run dev` only for frontend-only development; it does not start the Python backend, so `/api/*` requests can fail there.

### Phone/tunnel data mode

```bash
cd ~/studio/urdf-studio
npm run data
```

This path can create a public tunnel back into your local machine. Setup is not enough by itself; start now requires:
- an explicit acknowledgement before enabling that tunnel
- `URDF_SIMULATOR_API_TOKEN` to be set
- a manually installed `cloudflared` binary
- the reduced tunnel only exposes cam-to-sim session ingress, not the full backend API

Automatic `cloudflared` download is disabled for security.
If the tunnel cannot be established, startup now fails closed instead of silently continuing without the public phone link.

### Configure ports or bind hosts

```bash
npm run start -- --web-port 3001 --api-port 9001
```

For non-loopback binds, you must opt in explicitly:

```bash
npm run start -- --web-bind-host 0.0.0.0 --allow-remote --ack-remote-exposure
```

In non-interactive environments, acknowledgements can also be supplied with:

```bash
URDF_STUDIO_ACK_PUBLIC_TUNNEL=1 npm run data
URDF_STUDIO_ACK_REMOTE_EXPOSURE=1 npm run start -- --web-bind-host 0.0.0.0 --allow-remote
```

Minimal hardened data-mode example:

```bash
export URDF_SIMULATOR_API_TOKEN='change-this-to-a-long-random-secret'
cloudflared --version
npm run data -- --ack-public-tunnel
```

### Native IKD + Rust toolchain

If `config/app.config.json` has `ikd.enabled=true`, setup now installs Rust toolchain automatically when missing.

- Default behavior: auto-install Rust (via rustup) when needed.
- Disable auto-install: `URDF_STUDIO_SKIP_RUST_AUTO_INSTALL=1 npm run setup`
- Force-disable auto-install: `URDF_STUDIO_AUTO_INSTALL_RUST=0 npm run setup`

Ports and hosts are configurable via `config/app.config.json`, `URDF_*` env vars, or `npm run start -- --help` CLI flags.

If you intentionally need to run a pinned or custom checkout, you must acknowledge that explicitly:

```bash
npm run start -- --allow-outdated
URDF_STUDIO_ALLOW_OUTDATED=1 npm run start
```

### Quick Start Sample (SO-ARM100)
The Quick Start panel loads the SO-ARM100 URDF + meshes from the third_party submodule.

```bash
git submodule update --init --recursive
```

Then click **Load SO-ARM100** in the UI.

The integrated backend provides:
- `GET  /health` – Health check (yourdfpy status)
- `POST /ik/solve` – IK orchestration using configured solvers
- `POST /datasets/mix` – Mix multiple robot learning datasets

## Commands

- `npm run setup` - Install dependencies, local `ilu`, and auth prompts
- `npm run start` - Start the full local Studio stack (default)
- `npm run data` - Start Studio with phone/tunnel data mode
- `npm run dev` - Start Vite frontend only (development mode; backend is not started)
- `npm run typecheck` - Run TypeScript type checks
- `npm run test:backend` - Run backend pytest with the unified Python env (`.venv-lerobot/bin/python3`)
- `npm run smoke` - Run lint + typecheck

Run a specific backend test file with:

```bash
npm run test:backend -- backend/tests/test_datasets_service.py
```

## Verbose logging

If you want full Vite + backend logs while developing:

```bash
URDF_STUDIO_VERBOSE=1 npm run start
```

## Troubleshooting

### Setup appears frozen at "Setting up URDF Ops workspace"

That step manages the sibling `../urdf-ops` checkout. Check whether it exists and has dependencies:

```bash
ls -la ../urdf-ops
test -d ../urdf-ops/node_modules && echo deps-present
test -x ../urdf-ops/node_modules/.bin/vite && echo vite-present
```

If dependencies are present, rerun setup. It should skip the install and continue.

If you need to continue without URDF Ops setup:

```bash
URDF_STUDIO_SKIP_URDF_OPS_SETUP=1 npm run setup
```

### UI opens but backend calls fail

If you launched with `npm run dev`, this is expected because it starts the frontend only. Stop it and run:

```bash
npm run start
```

Then check:

```bash
curl http://127.0.0.1:8000/health
```

### URDF Ops does not open

Check both Ops services:

```bash
curl http://127.0.0.1:8001/health
curl -I http://127.0.0.1:5174
```

If ports are busy:

```bash
URDF_OPS_WEB_PORT=5176 URDF_OPS_API_PORT=8003 npm run start
```

## HuggingFace Token

The setup script will save your HuggingFace token to `.urdf-studio-config.json` (which is gitignored).

When running setup:
- **First time**: Enter your token or press Enter to skip
- **Subsequent runs**: 
  - Press Enter to keep current token
  - Enter new token to update
  - Type "remove" to delete the token

The token is automatically loaded when you start the app and is used for uploading and managing datasets on HuggingFace Spaces.

## GitHub Access

Recommended order:

1. Run `gh auth login` and let URDF Studio reuse that session without saving a local token.
2. Export `GITHUB_TOKEN` or `GH_TOKEN` in your shell.
3. Save a fine-grained GitHub token locally in `.urdf-studio-config.json` if you want a repo-specific fallback.

When setup detects existing `gh` or environment-based access, you can keep using it without saving another token locally.
