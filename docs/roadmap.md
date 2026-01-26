# RobotMLOps Roadmap

> **Last Updated:** 2026-01-26
> **Status:** Active Development

---

## Overview

| Version | Theme | Status |
|---------|-------|--------|
| **v0.1** | Core Loop (HF-First) | ✅ Complete |
| **v0.2** | Operational Maturity | 📋 Planned |
| **v0.3** | Robot-Native Evaluation | 📋 Planned |
| **v1.0** | Production Ready | 🔮 Future |

### One-Line Summaries

- **v0.1:** Reproducible experiments + persisted evals + HF export
- **v0.2:** Reliability + queue + observability + access + comparisons
- **v0.3:** Env-aware eval (Libero/MuJoCo) + real robot metrics + sim video
- **v1.0:** Multi-user, edge deployment, enterprise features

---

## v0.1 — RobotMLOps Core Loop (HF-First)

**Theme:** Experiments + persisted evals + HF export, on top of the existing training system.

### Ships

| Feature | Tag | Priority | Status |
|---------|-----|----------|--------|
| **Experiments Entity** | `core` | P0 | ✅ |
| Dataset revision pinning (HF commit SHA) | `hf` | P0 | ✅ |
| Evaluations persistence (DB + artifacts) | `core` | P0 | ✅ |
| Video playback (MP4 from obs frames) | `ui` | P1 | ✅ |
| Policy discovery API (adapter pattern) | `core` | P1 | ✅ |
| HF model export (checkpoint → HF repo) | `hf` | P1 | ✅ |
| Alembic migrations | `infra` | P0 | ✅ |
| Tracker subprocess robustness | `ops` | P1 | ✅ |

### Success Criteria

- [x] E2E: Create experiment → train → evaluate → watch video → export to HF
- [x] All data survives server restart
- [x] 4 policy architectures discoverable via API (ACT, Diffusion, TDMPC, VQ-BeT)
- [x] HF model repo created with valid model card

### Explicitly Deferred

- Model registry table
- Job queue
- Hyperparameter sweeps
- Libero/MuJoCo success metrics
- 3D rollout playback (URDF joint mapping)
- Multi-user / RBAC / API keys
- Production Modal/RunPod backends

---

## v0.2 — Operational Maturity + Governance

**Theme:** Make it reliable for teams and longer-running usage; start minimal "platform" controls.

### v0.2a: Reliability & Ops

| Feature | Tag | Priority | Status |
|---------|-----|----------|--------|
| **Job queue (FIFO)** | `ops` | P0 | ⬜ |
| Artifact indexing (DB table) | `infra` | P1 | ⬜ |
| Checkpoint retention policy | `ops` | P1 | ⬜ |
| Log streaming (SSE/WebSocket) | `ops` | P0 | ⬜ |
| Structured errors (traceback + exit codes) | `ops` | P1 | ⬜ |
| Comparison view v1 (2+ runs) | `ui` | P1 | ⬜ |

### v0.2b: Access + Integrations

| Feature | Tag | Priority | Status |
|---------|-----|----------|--------|
| **API keys** for SDK access | `infra` | P0 | ⬜ |
| HF private repos support | `hf` | P1 | ⬜ |
| Webhooks (Slack/Discord/HTTP) | `ops` | P1 | ⬜ |
| Model promotion metadata (HF tags) | `hf` | P2 | ⬜ |

### Success Criteria

- [ ] Can queue 5 jobs, they run in FIFO order
- [ ] Log streaming works in real-time (no polling)
- [ ] Webhook fires on job complete
- [ ] Can compare 2 runs side-by-side (config diff + metrics)
- [ ] SDK works with API key auth

### Explicitly Deferred

- Full model registry UI with stages + approvals
- Libero env integration
- Online RL training loop
- 3D playback

---

## v0.3 — Robot-Native Evaluation (Env/Task Aware)

**Theme:** Evolve from "offline action prediction eval" → real robot learning evaluation protocols.

### Core Additions

| Feature | Tag | Priority | Status |
|---------|-----|----------|--------|
| **EnvironmentConfig first-class** | `robot` | P0 | ⬜ |
| Libero evaluation harness | `robot` | P0 | ⬜ |
| Sim-rendered eval videos (MP4) | `robot` | P1 | ⬜ |
| Episode viewer upgrades | `ui` | P1 | ⬜ |
| Per-task metrics aggregation | `robot` | P1 | ⬜ |

### Optional

| Feature | Tag | Priority | Status |
|---------|-----|----------|--------|
| Dataset export to HF (eval packages) | `hf` | P2 | ⬜ |
| Sim asset versioning | `robot` | P2 | ⬜ |

### Success Criteria

- [ ] Can evaluate policy in Libero environment
- [ ] success_rate, reward, episode_length computed per task
- [ ] Rendered video artifact from simulation
- [ ] Multi-episode list with metrics in UI

### Explicitly Deferred

- Online RL (rollout collection → replay buffer → train)
- Sim-to-real tooling (domain randomization, calibration)
- Edge deployment wizard (Jetson, ROS2 packaging)
- Multi-user workspaces / RBAC

---

## Deferred Backlog

> Items explicitly deferred but not forgotten. Tagged by theme for future planning.

### A) Model Registry & Lifecycle (v0.4 / v1.0) `registry`

- [ ] Models table + UI (register, link to run/checkpoint/eval)
- [ ] Stage transitions: draft → staging → production → archived
- [ ] "Blessed" evaluations required for promotion
- [ ] Model cards + provenance completeness checks
- [ ] Model comparison across versions
- [ ] Model dependency graph (dataset/env/URDF)

### B) Sweeps & Automation (v0.4) `automation`

- [ ] Optuna sweeps (grid/random/Bayesian)
- [ ] Early stopping rules
- [ ] Results leaderboard
- [ ] Scheduled runs / cron triggers
- [ ] Retraining triggers on new data

### C) Online RL Pipeline (v0.5) `rl`

- [ ] Rollout collector workers
- [ ] Replay buffer snapshots as datasets
- [ ] Train-from-buffer pipeline
- [ ] Distributed rollouts (Ray-style)
- [ ] Safety constraints (terminate on unsafe states)

### D) 3D Playback & URDF Joint Mapping (v0.5) `viz`

- [ ] Robot descriptor storage (URDF + joint mapping + camera calibration)
- [ ] Three.js playback driven by episode states
- [ ] Export GIF/MP4 from Three.js viewer
- [ ] Debug overlays (contact points, joint limits)

### E) Deployment & Edge (v1.x) `deploy`

- [ ] Export ONNX + TensorRT
- [ ] ROS2 node generator (policy wrapper)
- [ ] Jetson deploy wizard + device inventory
- [ ] Inference benchmarking + latency budgets
- [ ] Model serving (HTTP/gRPC) with version routing

### F) Collaboration & Enterprise (v1.x) `enterprise`

- [ ] Workspaces / projects
- [ ] User accounts + RBAC
- [ ] Audit logs
- [ ] SSO / SAML
- [ ] Usage metering + quotas

### G) Compute Backends (v1.x) `compute`

- [ ] Modal/RunPod production implementation
- [ ] Kubernetes backend
- [ ] Autoscaling workers
- [ ] Spot instance support + retry policies
- [ ] Cost dashboards and budget alerts

---

## Labels Reference

| Tag | Description |
|-----|-------------|
| `core` | Core data model and APIs |
| `ops` | Reliability, observability, operations |
| `robot` | Robot-specific features (envs, evals) |
| `hf` | HuggingFace integration |
| `ui` | Frontend / visualization |
| `infra` | Infrastructure (migrations, storage) |
| `registry` | Model registry features |
| `automation` | Sweeps, scheduling, triggers |
| `rl` | Online RL features |
| `viz` | 3D visualization |
| `deploy` | Edge deployment |
| `enterprise` | Multi-user / enterprise |
| `compute` | Compute backends |

---

## Changelog

### 2026-01-26
- v0.1 marked as complete
- All v0.1 features implemented and tested
- Initial roadmap created
- Deferred backlog organized by theme
