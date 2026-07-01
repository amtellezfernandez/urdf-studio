# Setup

```bash
npm run setup
npm run start
```

Open the URL printed by the launcher, usually:

```text
http://127.0.0.1:5173
```

`npm run setup` installs Node dependencies and a local Python backend environment in `.venv`.

Optional simulator packages are not required to load and inspect URDF files. Install Genesis, MuJoCo, PyBullet, or Blender locally when you want to open a scene in that target runtime.

Useful checks:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:backend
npm run simulator:workspace:check:fixtures
```
