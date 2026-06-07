# RobotMLOps v0.1 Implementation Specification

> **Version**: 0.1.0
> **Status**: Implementation Ready
> **Date**: 2026-01-26

---

## Executive Summary

v0.1 delivers a complete RobotMLOps loop with HuggingFace-first design:
- **Experiments** to group runs by dataset + robot
- **Evaluation persistence** with episode artifacts
- **Policy discovery** via adapter pattern
- **HF leverage** with auto-pinned revisions and model export
- **Migrations** via Alembic for safe schema evolution
- **Video playback** when observation frames available

---

## Table of Contents

1. [Goals & Non-Goals](#1-goals--non-goals)
2. [Database Schema](#2-database-schema)
3. [API Endpoints](#3-api-endpoints)
4. [Implementation PRs](#4-implementation-prs)
5. [Testing Strategy](#5-testing-strategy)

---

## 1. Goals & Non-Goals

### Goals (v0.1)

| # | Goal | Description |
|---|------|-------------|
| G1 | Experiments | Group runs under (dataset, env, robot/urdf) |
| G2 | Evaluation Persistence | Store eval results in DB, episodes in artifacts |
| G3 | Policy Discovery | Adapter pattern instead of hardcoded list |
| G4 | HF Leverage | Auto-pin dataset revision + export to HF Hub |
| G5 | Migrations | Alembic for safe schema changes |
| G6 | Video Playback | MP4 from observation frames when available |

### Non-Goals (Deferred)

- Full sim-based success metrics (Libero/MuJoCo task success)
- 3D URDF rollout playback (Three.js driving joints)
- Hyperparameter sweeps
- Job queues
- Multi-user auth/RBAC
- Kubernetes deployment

---

## 2. Database Schema

### 2.1 New Tables

```sql
-- Alembic version tracking
CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL,
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Experiments table
CREATE TABLE experiments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    notes TEXT,
    tags TEXT,  -- JSON array

    -- Dataset reference
    dataset_source TEXT NOT NULL,  -- "huggingface" or "local"
    dataset_repo_id TEXT,
    dataset_local_path TEXT,
    dataset_version TEXT,  -- User-specified version/tag/branch
    dataset_resolved_revision TEXT,  -- Resolved commit SHA

    -- Robot reference
    robot_name TEXT,
    urdf_hash TEXT,

    -- Environment (nullable for v0.1)
    environment_config TEXT,  -- JSON

    -- Timestamps
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Evaluations table
CREATE TABLE evaluations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,  -- Training job reference
    experiment_id TEXT,  -- Optional experiment reference

    -- Checkpoint reference
    checkpoint_name TEXT NOT NULL,
    checkpoint_path TEXT,

    -- Configuration
    num_episodes INTEGER NOT NULL,
    seed INTEGER,
    max_steps INTEGER DEFAULT 1000,
    environment_config TEXT,  -- JSON (nullable in v0.1)

    -- Status
    status TEXT NOT NULL DEFAULT 'queued',  -- queued/running/completed/failed

    -- Results
    metrics TEXT,  -- JSON aggregate metrics
    error TEXT,  -- Error message/traceback

    -- Artifacts
    episodes_artifact_path TEXT,  -- Path to episodes JSON/JSONL
    video_artifact_paths TEXT,  -- JSON array of video paths

    -- Timestamps
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,

    FOREIGN KEY (run_id) REFERENCES jobs(job_id),
    FOREIGN KEY (experiment_id) REFERENCES experiments(id)
);

CREATE INDEX idx_evaluations_run ON evaluations(run_id);
CREATE INDEX idx_evaluations_experiment ON evaluations(experiment_id);
CREATE INDEX idx_evaluations_status ON evaluations(status);
```

### 2.2 Modified Tables

```sql
-- Add experiment_id to jobs table
ALTER TABLE jobs ADD COLUMN experiment_id TEXT REFERENCES experiments(id);
CREATE INDEX idx_jobs_experiment ON jobs(experiment_id);
```

---

## 3. API Endpoints

### 3.1 Experiments API

```
POST   /api/experiments              Create experiment
GET    /api/experiments              List experiments
GET    /api/experiments/{id}         Get experiment with runs
PATCH  /api/experiments/{id}         Update experiment
DELETE /api/experiments/{id}         Delete experiment
GET    /api/experiments/{id}/runs    List runs for experiment
GET    /api/experiments/{id}/evals   List evaluations for experiment
```

### 3.2 Evaluations API

```
POST   /api/runs/{run_id}/evaluate   Start evaluation
GET    /api/evaluations              List all evaluations
GET    /api/evaluations/{id}         Get evaluation details
GET    /api/evaluations/{id}/episodes  Get episodes data
DELETE /api/evaluations/{id}         Delete evaluation
```

### 3.3 Policies API

```
GET    /api/policies                 List available policies
GET    /api/policies/{id}            Get policy details + schema
```

### 3.4 HF Export API

```
POST   /api/models/export/hf         Export checkpoint to HuggingFace
```

### 3.5 Dataset Resolver

```
POST   /api/datasets/resolve         Resolve HF dataset to commit SHA
```

---

## 4. Implementation PRs

### PR1: Alembic Bootstrap

**Branch:** `pr/alembic-bootstrap`

**Files to Create:**
- `backend/alembic.ini`
- `backend/alembic/env.py`
- `backend/alembic/script.py.mako`
- `backend/alembic/versions/001_baseline.py`

**Files to Modify:**
- `pyproject.toml` - Add alembic dependency
- `backend/services/database.py` - Add migration runner

**Acceptance Criteria:**
- [ ] `alembic upgrade head` works on fresh DB
- [ ] Existing DBs can be stamped and migrated
- [ ] CI runs migration checks

---

### PR2: Experiments Table + API

**Branch:** `pr/experiments-api`

**Files to Create:**
- `backend/alembic/versions/002_experiments.py`
- `backend/models/experiments.py`
- `backend/api/experiments.py`
- `backend/services/experiments.py`

**Files to Modify:**
- `backend/app.py` - Add experiments router
- `backend/models/training.py` - Add experiment_id to TrainingStartRequest
- `backend/services/training.py` - Link jobs to experiments

**Acceptance Criteria:**
- [ ] CRUD operations work
- [ ] Jobs can be linked to experiments
- [ ] Legacy jobs show as "unassigned"

---

### PR3: Experiments UI

**Branch:** `pr/experiments-ui`

**Files to Create:**
- `web/src/features/experiments/ExperimentList.tsx`
- `web/src/features/experiments/CreateExperimentDialog.tsx`
- `web/src/features/experiments/ExperimentDetail.tsx`
- `web/src/features/experiments/useExperimentStore.ts` (enhance)

**Files to Modify:**
- `web/src/app/pages/RobotOps.tsx` - Update experiments tab
- `web/src/features/training/TrainingDialog.tsx` - Add experiment selector

**Acceptance Criteria:**
- [ ] User can create experiment
- [ ] User can view experiment with runs
- [ ] Training wizard can attach to experiment

---

### PR4: HF Dataset Revision Resolver

**Branch:** `pr/hf-resolver`

**Files to Create:**
- `backend/services/hf_resolver.py`

**Files to Modify:**
- `backend/api/datasets.py` - Add resolve endpoint
- `backend/services/experiments.py` - Auto-resolve on create
- `backend/services/training.py` - Store resolved SHA in job config
- `pyproject.toml` - Add huggingface_hub dependency

**Acceptance Criteria:**
- [ ] Resolver returns commit SHA for repo_id + version
- [ ] "main" resolves to actual SHA
- [ ] UI shows "pinned to: <sha>"

---

### PR5: Evaluations Persistence

**Branch:** `pr/evaluations-persistence`

**Files to Create:**
- `backend/alembic/versions/003_evaluations.py`
- `backend/models/evaluations.py`
- `backend/api/evaluations.py`
- `backend/services/evaluations.py`

**Files to Modify:**
- `backend/app.py` - Add evaluations router
- `backend/scripts/eval_policy.py` - Write episodes artifact
- `backend/services/training.py` - Update evaluate_policy to persist

**Acceptance Criteria:**
- [ ] Evaluation records created in DB
- [ ] Episodes stored as artifact
- [ ] Status transitions work (queued→running→completed/failed)
- [ ] Errors captured with traceback

---

### PR6: Evaluation UI + Playback

**Branch:** `pr/evaluation-ui`

**Files to Create:**
- `web/src/features/evaluation/EvaluationHistory.tsx`
- `web/src/features/evaluation/EvaluationDetail.tsx`
- `web/src/features/evaluation/EpisodeViewer.tsx`
- `web/src/features/evaluation/VideoPlayer.tsx`

**Files to Modify:**
- `web/src/features/evaluation/EvaluationPanel.tsx` - Link to history
- `web/src/app/pages/RobotOps.tsx` - Add evaluation routes

**Acceptance Criteria:**
- [ ] User can browse evaluation history
- [ ] User can view evaluation details + metrics
- [ ] User can view episode JSON data
- [ ] Video player shows MP4 if available

---

### PR7: Video Rendering (Best Effort)

**Branch:** `pr/video-rendering`

**Files to Modify:**
- `backend/scripts/eval_policy.py` - Add video writer
- `pyproject.toml` - Add imageio, imageio-ffmpeg

**Acceptance Criteria:**
- [ ] MP4 generated from image observations
- [ ] Graceful skip if no images
- [ ] Video stored via artifact storage

---

### PR8: Tracker/Subprocess Hardening

**Branch:** `pr/tracker-hardening`

**Files to Modify:**
- `backend/scripts/train_policy.py` - Write run_metadata.json
- `backend/services/training.py` - Poll and update tracker_url
- `backend/models/training.py` - Add run_metadata schema

**Acceptance Criteria:**
- [ ] Subprocess writes run_metadata.json with tracker_url
- [ ] Backend updates jobs.tracker_url from metadata
- [ ] Error tracebacks captured in job record

---

### PR9: Policy Discovery API

**Branch:** `pr/policy-discovery`

**Files to Create:**
- `backend/robotops/policies/__init__.py`
- `backend/robotops/policies/registry.py`
- `backend/robotops/policies/lerobot_adapter.py`
- `backend/api/policies.py`

**Files to Modify:**
- `backend/app.py` - Add policies router
- `web/src/features/training/ModelSelector.tsx` - Use /policies API

**Acceptance Criteria:**
- [ ] GET /policies returns discovered policies
- [ ] Fallback to minimal list on error
- [ ] UI uses API instead of hardcoded list

---

### PR10: HF Export (Checkpoint → Hub)

**Branch:** `pr/hf-export`

**Files to Create:**
- `backend/services/model_export.py`
- `backend/api/models.py`

**Files to Modify:**
- `backend/app.py` - Add models router
- `web/src/features/experiments/RunDetail.tsx` - Add export button

**Bundle Contents:**
- `model.safetensors` or `pytorch_model.bin`
- `config.json`
- `training_config.json`
- `dataset_ref.json` - {repo_id, version, resolved_sha}
- `urdf_hash.txt`
- `eval_summary.json` (if available)
- `README.md` - Auto-generated model card

**Acceptance Criteria:**
- [ ] Bundle created with all files
- [ ] Push to HF Hub (public repos)
- [ ] Returns repo URL + commit hash

---

## 5. Testing Strategy

### 5.1 Test Categories

| Category | Location | Runs In | Description |
|----------|----------|---------|-------------|
| Migration | `backend/tests/migrations/` | CI | Schema upgrade/downgrade |
| API Unit | `backend/tests/unit/` | CI | Endpoint validation |
| Integration | `backend/tests/integration/` | CI | Full API flows |
| UI Smoke | `web/tests/` | CI | Component rendering |

### 5.2 CI Configuration

```yaml
# Add to .github/workflows/ci.yml
- name: Run migration tests
  run: |
    cd backend
    alembic upgrade head
    alembic downgrade base
    alembic upgrade head

- name: Run API tests
  run: pytest backend/tests/ -v --ignore=backend/tests/gpu/
```

### 5.3 Test Fixtures

**Minimal test config** (`test_config.json`):
```json
{
  "dataset": {"source": "huggingface", "repo_id": "lerobot/pusht"},
  "model": {"architecture": "act"},
  "training": {"batch_size": 4, "epochs": 1}
}
```

---

## 6. File Structure (Final)

```
backend/
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       ├── 001_baseline.py
│       ├── 002_experiments.py
│       └── 003_evaluations.py
├── alembic.ini
├── api/
│   ├── experiments.py      # NEW
│   ├── evaluations.py      # NEW
│   ├── policies.py         # NEW
│   └── models.py           # NEW
├── models/
│   ├── experiments.py      # NEW
│   └── evaluations.py      # NEW
├── services/
│   ├── experiments.py      # NEW
│   ├── evaluations.py      # NEW
│   ├── hf_resolver.py      # NEW
│   └── model_export.py     # NEW
├── robotops/
│   └── policies/
│       ├── __init__.py     # NEW
│       ├── registry.py     # NEW
│       └── lerobot_adapter.py  # NEW
└── tests/
    ├── migrations/         # NEW
    └── unit/              # NEW

web/src/features/
├── experiments/
│   ├── ExperimentList.tsx      # NEW
│   ├── CreateExperimentDialog.tsx  # NEW
│   └── ExperimentDetail.tsx    # NEW
└── evaluation/
    ├── EvaluationHistory.tsx   # NEW
    ├── EvaluationDetail.tsx    # NEW
    ├── EpisodeViewer.tsx       # NEW
    └── VideoPlayer.tsx         # NEW
```

---

## 7. Dependencies to Add

**Python (`pyproject.toml`):**
```toml
dependencies = [
    # ... existing ...
    "alembic>=1.13.0",
    "huggingface_hub>=0.20.0",
    "imageio>=2.25.0",
    "imageio-ffmpeg>=0.4.9",
]
```

**Node (already sufficient):**
- Existing video player can use HTML5 video element

---

## 8. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HF_TOKEN` | HuggingFace API token (for export) | Required for export |
| `ALEMBIC_CONFIG` | Path to alembic.ini | `backend/alembic.ini` |

---

## 9. Rollback Plan

Each PR is independently revertable:
1. Alembic supports `downgrade` for schema changes
2. API changes are additive (no breaking changes)
3. UI changes are feature-flagged by route

---

## 10. Success Metrics

- [ ] User can create experiment → start training → run eval → view results
- [ ] Evaluation results persist across server restarts
- [ ] HF datasets pinned to commit SHA
- [ ] Checkpoint exportable to HF Hub
- [ ] No data loss on migration
