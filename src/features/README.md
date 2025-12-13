Feature slices for the `Index` page live here. Each folder owns a single concern so contributors can work without touching a 2k+ line page component. Prefer colocating hooks, pure helpers, and thin presentational components inside these slices.

- `camera/` – camera modals, POV toggles, export/import helpers.
- `dataset/` – episode load/save flows, mapping list/dialog wiring, rerun viewer triggers.
- `export/` – save/revert/export flows for URDF and related assets.
- `layout/` – sidebar widths/toggles, split view state, header actions.
- `motion-player/` – motion file upload, play/pause, frame counters, episode playback state.
- `object-creator/` – cube/point creator UI and robot bounding-box helpers.
- `theme-gpu/` – theme + GPU mode wrappers for the entry component.
- `types/` – shared types/interfaces consumed by multiple slices.
- `urdf-debug/` – mesh/reference debug UI and diagnostics.
- `urdf-editor/` – URDF edit actions (rename joints/links, axis/type changes, canonicalize/normalize).
- `urdf-loader/` – folder ingestion, URDF parsing, mesh registration, and debug info.
- `urdf-selection/` – selected/hovered joint/link/end-effector state and joint-value sync.
- `urdf-viewer/` – viewer wiring (collision visibility, rotation plane, split view) sitting on top of `Viewer3D`.
