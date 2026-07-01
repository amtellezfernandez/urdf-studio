# World Scene Package V1

URDF Studio sends simulator targets a JSON world package plus the robot URDF and uploaded mesh assets.

The package describes:

- `artifacts`: robot, mesh, and optional camera/object artifacts.
- `scene`: object instances, camera instances, and robot placement.
- `intents`: a stable transfer target such as `workspace_transfer`.

The backend validates and normalizes package digests before preparing a simulator workspace.
