# URDF Studio Setup

## Quick Start

### 1. Run Setup
```bash
cd ~/URDFStudio
npm run setup
```

This will:
- Show the setup roadmap
- Install all dependencies
- Set up the unified Python environment at `.venv-lerobot` with backend, Placo, LeRobot training, OpenArm hardware, MJLab, MuJoCo-Warp, and the MJX system-identification runtime
- Prompt you to configure HuggingFace authentication
- Prompt you to configure GitHub access
- Install the local `i-love-urdf` CLI for this repo (`npx ilu`)

Setup pins MuJoCo-Warp to the release that imports cleanly with the installed MuJoCo runtime.

### Install the `ilu` CLI globally too

URDF Studio works without a global `ilu` install. If you want `ilu` on your shell `PATH` everywhere, run:

```bash
cd ~/URDFStudio
npm run setup -- --install-global-ilu
```

The setup script will install the exact `i-love-urdf` package version already installed in this repo.

### Enable VGGT ("twin") dependencies

This clones `facebookresearch/vggt` into `./vggt/` and installs its Python requirements into `./.venv-lerobot/`.

```bash
cd ~/URDFStudio
npm run setup -- --twin
```

Or, if you prefer to do it during `npm install`:

```bash
cd ~/URDFStudio
npm install --twin
npm run setup
```

### 2. Start URDF Studio
```bash
cd ~/URDFStudio
npm run start
```

This will start:
- **Frontend**: `http://localhost:5173` (Vite + React)
- **Backend API**: `http://localhost:8000` (FastAPI + Python)

`npm run start` is the safe local default and keeps binds on loopback unless you override them explicitly.
It also checks the official `origin/main` branch and refuses to start stale checkouts until you update them.

### Phone/tunnel data mode

```bash
cd ~/URDFStudio
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

### MJX System Identification

Setup installs MJX, Optax, and the reusable `mujoco-sysid` package so synthetic system-identification benchmarks can run in the unified Python environment. The external source references live in:

- `third_party/mujoco-sysid`
- `third_party/mjx_sysid`

See [MJX System Identification](MJX_SYSTEM_ID.md) for the reuse boundary and MVP build order.

Run the SO100 MJX recovery benchmark with:

```bash
npm run sysid:so100
```

Run the SO100 differentiable geometry-repair benchmark with:

```bash
npm run sysid:so100:geometry
```

### IK Benchmark (SO-ARM100)
```bash
python backend/scripts/ik_benchmark.py
```

The integrated backend provides:
- `GET  /health` – Health check (yourdfpy status)
- `POST /ik/solve` – IK orchestration using configured solvers
- `POST /datasets/mix` – Mix multiple robot learning datasets

## Commands

- `npm run setup` - Install dependencies, local `ilu`, and auth prompts
- `npm run start` - Start URDF Studio locally (default)
- `npm run data` - Start URDF Studio with phone/tunnel data mode
- `npm run dev` - Start Vite dev server only (for development)
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
