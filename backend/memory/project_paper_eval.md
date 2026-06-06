---
name: project-paper-eval
description: Paper-grade WSP evaluation framework — corruption suite, baselines, metrics harness
metadata:
  type: project
---

WSP paper evaluation framework built on branch `hkhack`.

**Why:** GBA/frontier-AI pitch needs defensible benchmarks. Minimum publishable experiment = real SO-101/SO-100 episodes + 10 known corruptions + WSP vs 4 baselines.

**Key finding baked into tests:**
- C9 (robot/object interpenetration) → WSP catches it (AABB overlap, no contact relation present)
- C8 (impossible contact transition, entities 0.8m apart) → WSP MISSES it (contact relation present exempts overlap check); kinematic_check catches it

**Files:**
- `backend/services/wsp_corruption_suite.py` — 10 corruptions (C1–C10), `build_eval_corpus(clean_traces)`
- `backend/services/wsp_eval_baselines.py` — 5 methods returning (score, runtime_ms)
- `backend/services/wsp_paper_eval.py` — `run_paper_eval(corpus)` → `EvalReport`, `format_eval_table(report)`
- `backend/services/wsp_lerobot_hf_ingest.py` — SO-101 + SO-100 HF ingest, `robot="so101"|"so100"`

**How to apply:** Minimum experiment uses `load_lerobot_hf_episode("lerobot/svla_so101_pickplace", i, max_frames=50)` for N episodes, then `build_eval_corpus` + `run_paper_eval`. Also works with SO-100 dataset `lerobot/svla_so100_pickplace`.

**Test count at time of writing:** 610 passed, 3 skipped (40 new tests in test_wsp_corruption_suite.py and test_wsp_paper_eval.py).
