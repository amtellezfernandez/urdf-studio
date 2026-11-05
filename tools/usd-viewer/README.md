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
runtime files. To bootstrap the pinned source and Emscripten 3.1.55 into the
repository cache and build the binding, run:

```bash
node tools/usd-viewer/build-bindings.mjs --bootstrap
```

For CI or an already provisioned machine, set `OPENUSD_EMSCRIPTEN_SOURCE` to
the `needle/feature/wasm-improvements` checkout and `EMSDK` to the activated
Emscripten checkout, then run the same script without `--bootstrap`.
