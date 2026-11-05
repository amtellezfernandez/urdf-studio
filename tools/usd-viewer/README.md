# OpenUSD browser binding

The checked-in files under `web/public/usd-viewer/bindings/` are the runtime
artifacts used by the application. They are not hand-edited: regenerate them
from the pinned OpenUSD/HdEmscripten source before replacing them.

The current artifact was built from OpenUSD `pxrInternal_v0_24` and contains a
custom `Emscripten_Rprim`. The application-side renderer supports `constant`,
`uniform`, and `vertex` display colors, but the current binary still rejects
`uniform` in its Hydra primvar sync. A rebuilt binding must make this check
pass in the browser before it is committed:

```text
displayColor interpolation=uniform -> updatePrimvar(..., "uniform")
```

The source and Emscripten SDK are intentionally build inputs, not vendored
runtime files. Set `OPENUSD_EMSCRIPTEN_SOURCE` and `EMSDK` in the build
environment, then run `node tools/usd-viewer/build-bindings.mjs`.
