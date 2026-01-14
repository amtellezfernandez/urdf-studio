# URDF Studio

Yo! URDF Studio is your spot to load a robot, tweak joints, and try to replay some leRobotDatasets or policies :) compatible with v3 and v2.1

## 🚀 Spin It Up
```bash
npm install
npm run dev
```

## 🤖 What You Can Do
- Drag in a URDF folder (zip it up with meshes) and the bot pops into the viewer.
- Scrub joints, drop keyframes, and build sequences without wrestling XML.
- Record takes, retake them, and export slick JSON motion packs or full archives.
- Re-import those JSONs later, hit play, and watch your bot vibe.

## 🛠 Stack
- Zustand keeps joint state locked in.
- 3D viewer is live — sliders and nodes update the robot instantly.
- Import/export supports multi-episode JSON bundles with a manifest, so sharing or versioning is easy.

## 🧪 Dev Tips
- `URDF_STUDIO_VERBOSE=1 npm run start` to see full Vite + backend logs.
- `npm run smoke` to run lint + typecheck quickly.

## 🗂 Project Layout
- `apps/web` - Vite + React frontend
- `apps/api/backend` - FastAPI backend
- `tools/scripts` - CLI + dev scripts
- `tools/segmentation` - mesh segmentation utilities
- `vendor/pyroki` - vendored PyRoki
- `docs` - setup + teleoperation guides
- `samples` - sample data files

## 📚 Docs
- [Setup](docs/SETUP.md)
- [Teleoperation](docs/TELEOPERATION.md)
- [Dev notes](docs/dev_notes.md)
- [Sample animation](samples/test-animation.csv)
