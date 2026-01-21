# URDF Studio

URDF Studio loads robot URDFs, lets you manipulate joints and keyframes, and replays LeRobot datasets or policies (v3 and v2.1).

## Prerequisites
- Node.js and npm
- Python 3
- `uv` (https://astral.sh/uv) for Python virtual environments
- Build tools for native Python deps (Linux):
  ```bash
  sudo apt-get update
  sudo apt-get install python3-dev build-essential
  ```

## Setup
```bash
npm run setup
```

This installs npm dependencies, creates a Python virtual environment, and installs the backend Python deps (Rerun SDK, Placo). It also prompts for optional Hugging Face and GitHub tokens.

If you want the Quick Start sample (SO-ARM100), initialize the submodules:
```bash
git submodule update --init --recursive
```

## Run
```bash
npm run start
```

This starts:
- Frontend: `http://localhost:5173` (Vite + React)
- Backend API: `http://localhost:8000` (FastAPI)

For frontend-only development:
```bash
npm install
npm run dev
```

## Architecture
```mermaid
graph LR
  Developer[Developer] -->|HTTP| Frontend[Vite + React\n:5173]
  Frontend -->|REST/JSON| Backend[FastAPI\n:8000]
  Backend -->|Python| Venv[.venv\nrerun-sdk, placo]
  Backend -->|Optional| HF[Hugging Face API]
  Backend -->|Optional| GH[GitHub API]
  Frontend -->|Assets| URDF[URDF + meshes]
```

## Setup and Run Flow
```mermaid
flowchart TD
  A[Clone repo] --> B[Install prerequisites\nNode, Python3, uv]
  B --> C[npm run setup]
  C --> D[npm run start]
  D --> E[Open http://localhost:5173]
  C --> F[Optional: configure HF/GitHub tokens]
  C --> G[Optional: git submodule update --init --recursive]
```

## Data Flow
```mermaid
flowchart LR
  Import[URDF + meshes] --> Viewer[Three.js URDF loader\nScene graph]
  Viewer --> Editor[Joint controls\nKeyframes]
  Editor --> Export[JSON motion packs\nArchives]
  Export --> Import
  Viewer --> Backend[Validation/IK\nBackend API]
  Backend --> Py[Python FK/IK\nplaco, pyroki optional]
  Backend --> Rerun[Rerun visualization]
```

## Backend Endpoints
```mermaid
flowchart TD
  Client[Frontend or CLI] --> H[/GET /health/]
  Client --> FK[/POST /pyroki/fk/]
  Client --> Rv[/POST /rerun/visualize/]
  Client --> Mix[/POST /datasets/mix/]

  H --> Health[Status: PyRoki, yourdfpy, Rerun]
  FK --> PyRoki[PyRoki FK\nURDF cache]
  Rv --> Rerun[Rerun spawn/serve]
  Mix --> Datasets[Dataset mixer\nmanifest output]
```

## Optional: Quick Start Sample (SO-ARM100)
```bash
git submodule update --init --recursive
```

Then click **Load SO-ARM100** in the Quick Start panel.

## Features
- Import a URDF folder (zip with meshes) into the viewer.
- Scrub joints, add keyframes, and build sequences.
- Record and export JSON motion packs or full archives; re-import to replay.

## Dev Tips
- `URDF_STUDIO_VERBOSE=1 npm run start` for verbose Vite + backend logs.
- `npm run smoke` runs lint + typecheck + dead-code check.

## Docs
- [Docs index](docs/README.md)
- [Setup](docs/SETUP.md)
- [Teleoperation](docs/TELEOPERATION.md)
- [Dev notes](docs/dev_notes.md)
