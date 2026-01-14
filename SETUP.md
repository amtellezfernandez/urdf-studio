# URDF Studio Setup

## Quick Start

### 1. Run Setup
```bash
cd ~/URDFStudio
npm run setup
```

This will:
- Show a beautiful banner
- Install all dependencies
- Set up Python virtual environment with Rerun SDK
- Prompt you to configure HuggingFace authentication (optional)
- Prompt you to configure GitHub authentication (optional)

### Optional: Enable PyRoki FK validation

If you want to compare forward kinematics between the Three.js URDFLoader and [PyRoki](https://github.com/chungmin99/pyroki), install the vendored PyRoki into the local virtual environment:

```bash
cd ~/URDFStudio
~/.local/bin/uv pip install --python .venv/bin/python3 -e ./pyroki
```

Once installed, the FK validation popup in the viewer will call into PyRoki via the existing Python environment.

### 2. Start URDF Studio
```bash
cd ~/URDFStudio
npm run start
```

This will start:
- **Frontend**: `http://localhost:5173` (Vite + React)
- **Backend API**: `http://localhost:8000` (FastAPI + Python)

The integrated backend provides:
- `GET  /health` – Health check (PyRoki, yourdfpy, Rerun status)
- `POST /pyroki/fk` – Forward kinematics using PyRoki (with URDF caching)
- `POST /rerun/visualize` – Rerun visualization (spawn or serve modes)
- `POST /datasets/mix` – Mix multiple robot learning datasets

## Commands

- `npm run setup` - Install dependencies and configure tokens
- `npm run start` - Start URDF Studio (default)
- `npm run dev` - Start Vite dev server only (for development)
- `npm run typecheck` - Run TypeScript type checks
- `npm run smoke` - Run lint + typecheck

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
