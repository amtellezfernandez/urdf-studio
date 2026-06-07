# RobotMLOps Core v0.1 - Technical Specification

> **Branch**: `feature/robotops-training`
> **Version**: v0.1.0
> **Status**: Draft
> **Last Updated**: 2026-01-26

---

## Table of Contents

1. [Scope & Non-Goals](#1-scope--non-goals)
2. [User Stories](#2-user-stories)
3. [Data Model & Schema](#3-data-model--schema)
4. [API Surface](#4-api-surface)
5. [Storage Layout](#5-storage-layout)
6. [Execution Model](#6-execution-model)
7. [Testing Strategy](#7-testing-strategy)
8. [Implementation Plan](#8-implementation-plan)

---

## 1. Scope & Non-Goals

### 1.1 Goals (v0.1)

| Goal | Description |
|------|-------------|
| **Experiments** | Group training + evaluation runs under a versioned (dataset, environment) pair |
| **Runs** | Track individual training and evaluation executions with full provenance |
| **Artifacts** | First-class artifact storage with content hashing, MinIO/S3 backend |
| **Evaluation Persistence** | Store evaluation metrics in DB, episodes + videos in object storage |
| **Environments** | First-class environment concept for simulation (Libero task/suite selection) |
| **Playback** | Video-first evaluation playback in UI |
| **Policy Discovery** | Adapter pattern for listing available policies without hardcoding imports |

### 1.2 Non-Goals (Deferred to v0.2+)

| Non-Goal | Reason |
|----------|--------|
| 3D URDF-based rollout playback | Complex; video playback sufficient for v0.1 |
| DVC integration | Local dataset versioning deferred |
| Cloud compute backends (Modal, RunPod) | Local training focus first |
| Policy/checkpoint comparison UI | Basic single-run view first |
| Custom policy upload | Discovery of built-in policies only |
| Multi-GPU / distributed training | Single GPU sufficient for v0.1 |
| Real robot deployment | Training and simulation only |

### 1.3 Success Criteria

1. **E2E Flow**: User can create experiment → start training → view metrics → run evaluation → watch video
2. **Persistence**: All data survives server restart
3. **Reproducibility**: Same seed + config produces identical results
4. **Tracking**: Real-time metrics logged to MLflow/W&B
5. **Artifacts**: Checkpoints stored in MinIO with content hashing

---

## 2. User Stories

### US-A: Create Experiment

> **As a** researcher, **I want to** create an experiment that pins a dataset and environment, **so that** all runs share the same data context.

#### Deliverables

| Component | File | Description |
|-----------|------|-------------|
| API | `backend/api/experiments.py` | CRUD endpoints |
| Model | `backend/models/experiments.py` | Pydantic schemas |
| Service | `backend/services/experiments.py` | Business logic |
| Frontend | `web/src/features/experiments/CreateExperimentDialog.tsx` | Form UI |
| Store | `web/src/features/experiments/useExperimentStore.ts` | Zustand state |

#### Acceptance Criteria

- [ ] **AC-A1**: User can name experiment and add optional description
- [ ] **AC-A2**: User can select dataset source (HuggingFace or Local)
- [ ] **AC-A3**: For HuggingFace datasets, version is resolved and pinned at creation (not "latest")
- [ ] **AC-A4**: User can optionally select environment (e.g., Libero suite/task)
- [ ] **AC-A5**: Experiment creation persists to SQLite and appears in dashboard
- [ ] **AC-A6**: Experiment list shows: name, dataset, environment, run count, created date

#### Testing

```gherkin
Scenario: Create HuggingFace experiment
  Given I am on the experiments page
  When I click "New Experiment"
  And I enter name "pusht-act-v1"
  And I select dataset source "HuggingFace"
  And I enter repo_id "lerobot/pusht"
  And I click "Create"
  Then experiment appears in list with pinned version
  And experiment has 0 runs

Scenario: Create Libero experiment
  Given I am on the experiments page
  When I click "New Experiment"
  And I select environment "Libero"
  And I select suite "libero_spatial"
  And I select task "pick_up_the_black_bowl"
  And I click "Create"
  Then experiment shows environment configuration
```

---

### US-B: Start Training Run

> **As a** researcher, **I want to** start a training run within an experiment, **so that** I can train a policy on the pinned dataset.

#### Deliverables

| Component | File | Description |
|-----------|------|-------------|
| API | `backend/api/runs.py` | POST /experiments/{id}/runs |
| Model | `backend/models/runs.py` | RunCreate, RunResponse schemas |
| Service | `backend/services/training.py` | Run management, subprocess launch |
| Script | `backend/scripts/train_policy.py` | Training subprocess |
| Frontend | `web/src/features/experiments/StartRunDialog.tsx` | Policy + hyperparameter form |

#### Acceptance Criteria

- [ ] **AC-B1**: User selects policy architecture from discovered list (ACT, Diffusion, TDMPC, VQ-BeT)
- [ ] **AC-B2**: User configures hyperparameters (batch_size, learning_rate, epochs, seed)
- [ ] **AC-B3**: User optionally configures experiment tracker (MLflow, W&B, or None)
- [ ] **AC-B4**: Run starts and shows in experiment's run list immediately (status: "queued")
- [ ] **AC-B5**: Training subprocess logs metrics to tracker in real-time
- [ ] **AC-B6**: Run record includes full provenance: code version (git SHA), dataset version, config snapshot

#### Testing

```gherkin
Scenario: Start training run
  Given experiment "pusht-act-v1" exists
  When I click "New Run" on the experiment
  And I select policy "ACT"
  And I set batch_size=8, learning_rate=1e-4, epochs=10
  And I select tracker "MLflow"
  And I click "Start"
  Then run appears with status "running"
  And MLflow shows the run with logged config
  And loss metrics update in real-time
```

---

### US-C: Monitor Training

> **As a** researcher, **I want to** see training progress and metrics, **so that** I know how training is going.

#### Deliverables

| Component | File | Description |
|-----------|------|-------------|
| API | `backend/api/runs.py` | GET /runs/{id}, GET /runs/{id}/metrics |
| Frontend | `web/src/features/experiments/RunDetails.tsx` | Progress, metrics, logs |
| Frontend | `web/src/features/metrics/LossCurve.tsx` | Recharts loss visualization |

#### Acceptance Criteria

- [ ] **AC-C1**: Dashboard shows run status (queued, running, completed, failed, cancelled)
- [ ] **AC-C2**: Progress bar shows current epoch/step and ETA
- [ ] **AC-C3**: Loss curve updates in real-time (polling every 5s)
- [ ] **AC-C4**: User can view training logs (tail -f style)
- [ ] **AC-C5**: User can cancel running job

#### Testing

```gherkin
Scenario: Monitor training progress
  Given a training run is in progress
  When I open the run details
  Then I see progress bar with current step
  And I see loss curve updating
  And I see "Cancel" button

Scenario: Cancel training
  Given a training run is in progress
  When I click "Cancel"
  Then run status changes to "cancelled"
  And subprocess is terminated
```

---

### US-D: Run Evaluation

> **As a** researcher, **I want to** evaluate a trained checkpoint in simulation, **so that** I can measure policy performance.

#### Deliverables

| Component | File | Description |
|-----------|------|-------------|
| API | `backend/api/evaluations.py` | POST /runs/{id}/evaluate |
| Model | `backend/models/evaluations.py` | EvalCreate, EvalResponse schemas |
| Service | `backend/services/evaluation.py` | Evaluation orchestration |
| Script | `backend/scripts/eval_policy.py` | Evaluation subprocess |
| Frontend | `web/src/features/evaluation/EvaluationPanel.tsx` | Eval config + results |

#### Acceptance Criteria

- [ ] **AC-D1**: User selects checkpoint from run (or "latest")
- [ ] **AC-D2**: User configures evaluation parameters (num_episodes, seed)
- [ ] **AC-D3**: Evaluation runs in simulation environment defined by experiment
- [ ] **AC-D4**: Episode metrics (success_rate, avg_return, episode_length) stored in DB
- [ ] **AC-D5**: Episode trajectories + videos stored in object storage
- [ ] **AC-D6**: Evaluation appears in run's evaluation list

#### Testing

```gherkin
Scenario: Run evaluation on trained policy
  Given training run "run-001" is completed
  And experiment has Libero environment configured
  When I click "Evaluate" on the run
  And I set num_episodes=10, seed=42
  And I click "Start Evaluation"
  Then evaluation runs 10 episodes
  And success_rate is calculated and stored
  And video artifacts are uploaded to MinIO

Scenario: Evaluate PushT policy
  Given training run with ACT policy on pusht dataset
  When I run evaluation
  Then episodes run in PushT environment
  And metrics show avg_return
```

---

### US-E: View Evaluation Results

> **As a** researcher, **I want to** view evaluation metrics and watch episode videos, **so that** I can assess policy quality.

#### Deliverables

| Component | File | Description |
|-----------|------|-------------|
| API | `backend/api/evaluations.py` | GET /evaluations/{id}, GET /evaluations/{id}/episodes |
| Frontend | `web/src/features/evaluation/EvaluationResults.tsx` | Metrics summary |
| Frontend | `web/src/features/evaluation/EpisodePlayer.tsx` | Video playback |

#### Acceptance Criteria

- [ ] **AC-E1**: Results page shows aggregate metrics (success_rate, avg_return, std_return)
- [ ] **AC-E2**: Episode list shows per-episode metrics (return, success, length)
- [ ] **AC-E3**: User can click episode to watch video playback
- [ ] **AC-E4**: Video player has play/pause, seek, speed controls
- [ ] **AC-E5**: User can export results as JSON/CSV

#### Testing

```gherkin
Scenario: View evaluation results
  Given evaluation "eval-001" is completed
  When I open evaluation details
  Then I see success_rate: 0.8 (8/10 episodes)
  And I see episode list with individual metrics

Scenario: Watch episode video
  Given evaluation has recorded videos
  When I click on episode #3
  Then video player loads
  And I can play the robot rollout
```

---

### US-F: Policy Discovery

> **As a** researcher, **I want to** see available policy architectures, **so that** I can choose the right model.

#### Deliverables

| Component | File | Description |
|-----------|------|-------------|
| Registry | `backend/robotops/policies/registry.py` | Policy adapter registry |
| Adapters | `backend/robotops/policies/lerobot_adapter.py` | LeRobot policy discovery |
| API | `backend/api/policies.py` | GET /policies |
| Frontend | `web/src/features/training/PolicySelector.tsx` | Policy dropdown with info |

#### Acceptance Criteria

- [ ] **AC-F1**: API returns list of available policies with metadata
- [ ] **AC-F2**: Each policy has: name, description, default hyperparameters, supported input modalities
- [ ] **AC-F3**: Policies discovered via adapter pattern (not hardcoded imports)
- [ ] **AC-F4**: Frontend shows policy cards with descriptions
- [ ] **AC-F5**: Selecting policy pre-fills default hyperparameters

#### Testing

```gherkin
Scenario: List available policies
  When I call GET /policies
  Then I receive list including:
    | name | description |
    | ACT | Action Chunking Transformer |
    | Diffusion | Diffusion Policy |
    | TDMPC | Temporal Difference MPC |
    | VQ-BeT | VQ-BeT policy |

Scenario: Select policy in UI
  Given I am starting a new run
  When I select "ACT" policy
  Then hyperparameters form shows ACT defaults:
    | param | value |
    | chunk_size | 100 |
    | hidden_dim | 256 |
```

---

### US-G: Artifact Management

> **As a** researcher, **I want to** download checkpoints and artifacts, **so that** I can use trained models elsewhere.

#### Deliverables

| Component | File | Description |
|-----------|------|-------------|
| Service | `backend/services/artifact_storage.py` | Enhanced with content hashing |
| API | `backend/api/artifacts.py` | GET /runs/{id}/artifacts, GET /artifacts/{id}/download |
| Frontend | `web/src/features/artifacts/ArtifactBrowser.tsx` | List + download UI |

#### Acceptance Criteria

- [ ] **AC-G1**: Artifacts listed with metadata (name, size, hash, created_at)
- [ ] **AC-G2**: User can download checkpoint files
- [ ] **AC-G3**: Artifacts have content hash (SHA-256) for integrity verification
- [ ] **AC-G4**: Artifacts have provenance link to originating run
- [ ] **AC-G5**: Storage backend abstraction (local or MinIO/S3)

#### Testing

```gherkin
Scenario: Download checkpoint
  Given training run "run-001" is completed
  When I open artifacts tab
  Then I see "final_model" checkpoint (150MB)
  And I see SHA-256 hash
  When I click "Download"
  Then file downloads with correct hash

Scenario: Artifact provenance
  Given artifact "checkpoint_epoch_10.pt"
  When I view artifact details
  Then I see:
    - run_id: run-001
    - experiment_id: exp-001
    - created_at: 2026-01-26T10:30:00Z
```

---

## 3. Data Model & Schema

### 3.1 Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  Experiment │1─────*│     Run     │1─────*│  Artifact   │
│             │       │             │       │             │
│ id          │       │ id          │       │ id          │
│ name        │       │ experiment_id│      │ run_id      │
│ dataset     │       │ type (train/eval)│  │ name        │
│ environment │       │ status      │       │ path        │
│ created_at  │       │ config      │       │ hash        │
└─────────────┘       │ metrics     │       │ size        │
                      │ created_at  │       │ created_at  │
                      └─────────────┘       └─────────────┘
                            │
                            │1
                            │
                            ▼*
                      ┌─────────────┐
                      │  Evaluation │
                      │             │
                      │ id          │
                      │ run_id      │
                      │ checkpoint  │
                      │ config      │
                      │ metrics     │
                      │ episodes    │
                      │ created_at  │
                      └─────────────┘
```

### 3.2 SQLite Schema

```sql
-- =============================================================================
-- Experiments
-- =============================================================================
CREATE TABLE experiments (
    id TEXT PRIMARY KEY,                    -- UUID
    name TEXT NOT NULL,
    description TEXT,

    -- Dataset configuration (JSON)
    dataset_config TEXT NOT NULL,           -- {"source": "huggingface", "repo_id": "...", "version": "..."}

    -- Environment configuration (JSON, nullable)
    environment_config TEXT,                -- {"type": "libero", "suite": "...", "task": "..."}

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(name)
);

-- =============================================================================
-- Runs (training and evaluation)
-- =============================================================================
CREATE TABLE runs (
    id TEXT PRIMARY KEY,                    -- UUID
    experiment_id TEXT NOT NULL,

    -- Run type
    type TEXT NOT NULL CHECK(type IN ('training', 'evaluation')),

    -- Status
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),

    -- Configuration (JSON)
    config TEXT NOT NULL,                   -- Full config snapshot

    -- Provenance
    git_sha TEXT,                           -- Code version
    parent_run_id TEXT,                     -- For evaluation: the training run
    checkpoint_path TEXT,                   -- For evaluation: which checkpoint

    -- Metrics (JSON, updated during training)
    metrics TEXT,                           -- {"loss": 0.1, "learning_rate": 1e-4, ...}

    -- Progress
    current_step INTEGER DEFAULT 0,
    total_steps INTEGER,
    current_epoch INTEGER DEFAULT 0,
    total_epochs INTEGER,

    -- Metadata
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_runs_experiment ON runs(experiment_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_type ON runs(type);

-- =============================================================================
-- Artifacts
-- =============================================================================
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,                    -- UUID
    run_id TEXT NOT NULL,

    -- Artifact info
    name TEXT NOT NULL,                     -- "checkpoint_epoch_10", "final_model", "config.json"
    artifact_type TEXT NOT NULL,            -- "checkpoint", "config", "log", "video", "trajectory"

    -- Storage
    storage_path TEXT NOT NULL,             -- Relative path in storage backend
    storage_backend TEXT NOT NULL DEFAULT 'local',  -- "local" or "s3"

    -- Integrity
    content_hash TEXT,                      -- SHA-256
    size_bytes INTEGER,

    -- Metadata
    metadata TEXT,                          -- JSON: {"epoch": 10, "step": 5000, ...}
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    UNIQUE(run_id, name)
);

CREATE INDEX idx_artifacts_run ON artifacts(run_id);
CREATE INDEX idx_artifacts_type ON artifacts(artifact_type);

-- =============================================================================
-- Evaluations
-- =============================================================================
CREATE TABLE evaluations (
    id TEXT PRIMARY KEY,                    -- UUID
    run_id TEXT NOT NULL,                   -- The training run being evaluated

    -- Configuration
    checkpoint_name TEXT NOT NULL,          -- "final_model" or "checkpoint_epoch_10"
    num_episodes INTEGER NOT NULL,
    seed INTEGER,
    config TEXT NOT NULL,                   -- Full eval config JSON

    -- Status
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed')),

    -- Aggregate metrics (JSON)
    metrics TEXT,                           -- {"success_rate": 0.8, "avg_return": 150.5, ...}

    -- Metadata
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_evaluations_run ON evaluations(run_id);

-- =============================================================================
-- Episodes (individual evaluation episodes)
-- =============================================================================
CREATE TABLE episodes (
    id TEXT PRIMARY KEY,                    -- UUID
    evaluation_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,

    -- Metrics
    success BOOLEAN,
    total_return REAL,
    episode_length INTEGER,

    -- Artifacts (stored separately, referenced by path)
    video_artifact_id TEXT,                 -- Reference to artifact
    trajectory_artifact_id TEXT,            -- Reference to artifact

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE,
    FOREIGN KEY (video_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
    FOREIGN KEY (trajectory_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
    UNIQUE(evaluation_id, episode_number)
);

CREATE INDEX idx_episodes_evaluation ON episodes(evaluation_id);

-- =============================================================================
-- Policies (discovered policies cache)
-- =============================================================================
CREATE TABLE policies (
    id TEXT PRIMARY KEY,                    -- "act", "diffusion", etc.
    name TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL,                   -- "lerobot", "custom"

    -- Configuration schema (JSON)
    default_config TEXT,                    -- Default hyperparameters
    config_schema TEXT,                     -- JSON Schema for validation

    -- Metadata
    version TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.3 Migration Plan

```python
# backend/migrations/001_robotmlops_core.py
"""
RobotMLOps Core v0.1 - Initial Schema

Creates tables for experiments, runs, artifacts, evaluations, episodes, and policies.
"""

MIGRATION_ID = "001_robotmlops_core"
MIGRATION_DATE = "2026-01-26"

UP = """
-- All CREATE TABLE statements from schema above
"""

DOWN = """
DROP TABLE IF EXISTS episodes;
DROP TABLE IF EXISTS evaluations;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS experiments;
DROP TABLE IF EXISTS policies;
"""
```

**Migration Strategy:**
1. Add migration runner in `backend/services/migrations.py`
2. Run migrations on app startup
3. Track applied migrations in `migrations` table
4. Support rollback for development

---

## 4. API Surface

### 4.1 Experiments

#### POST /api/experiments

Create a new experiment.

**Request:**
```json
{
  "name": "pusht-act-baseline",
  "description": "ACT policy baseline on PushT dataset",
  "dataset": {
    "source": "huggingface",
    "repo_id": "lerobot/pusht",
    "version": "v1.0"
  },
  "environment": null
}
```

**Response (201):**
```json
{
  "id": "exp-a1b2c3d4",
  "name": "pusht-act-baseline",
  "description": "ACT policy baseline on PushT dataset",
  "dataset": {
    "source": "huggingface",
    "repo_id": "lerobot/pusht",
    "version": "v1.0",
    "resolved_version": "1.0.0"
  },
  "environment": null,
  "run_count": 0,
  "created_at": "2026-01-26T10:00:00Z"
}
```

#### GET /api/experiments

List all experiments.

**Response (200):**
```json
{
  "experiments": [
    {
      "id": "exp-a1b2c3d4",
      "name": "pusht-act-baseline",
      "dataset": {
        "source": "huggingface",
        "repo_id": "lerobot/pusht"
      },
      "environment": null,
      "run_count": 5,
      "latest_run_status": "completed",
      "created_at": "2026-01-26T10:00:00Z"
    }
  ],
  "total": 1
}
```

#### GET /api/experiments/{experiment_id}

Get experiment details with runs.

**Response (200):**
```json
{
  "id": "exp-a1b2c3d4",
  "name": "pusht-act-baseline",
  "description": "ACT policy baseline on PushT dataset",
  "dataset": {
    "source": "huggingface",
    "repo_id": "lerobot/pusht",
    "version": "v1.0",
    "resolved_version": "1.0.0"
  },
  "environment": null,
  "runs": [
    {
      "id": "run-001",
      "type": "training",
      "status": "completed",
      "config": {"policy": "act", "batch_size": 8},
      "metrics": {"final_loss": 0.05},
      "created_at": "2026-01-26T10:30:00Z"
    }
  ],
  "created_at": "2026-01-26T10:00:00Z"
}
```

---

### 4.2 Runs

#### POST /api/experiments/{experiment_id}/runs

Start a new training run.

**Request:**
```json
{
  "type": "training",
  "config": {
    "policy": {
      "architecture": "act",
      "config": {
        "chunk_size": 100,
        "hidden_dim": 256
      }
    },
    "training": {
      "batch_size": 8,
      "learning_rate": 1e-4,
      "epochs": 100,
      "seed": 42
    },
    "tracker": {
      "type": "mlflow",
      "tracking_uri": "http://localhost:5000",
      "experiment_name": "pusht-act-baseline"
    }
  }
}
```

**Response (201):**
```json
{
  "id": "run-001",
  "experiment_id": "exp-a1b2c3d4",
  "type": "training",
  "status": "queued",
  "config": { ... },
  "provenance": {
    "git_sha": "abc123def",
    "dataset_version": "1.0.0",
    "created_at": "2026-01-26T10:30:00Z"
  },
  "tracker_url": "http://localhost:5000/#/experiments/1/runs/abc123"
}
```

#### GET /api/runs/{run_id}

Get run details.

**Response (200):**
```json
{
  "id": "run-001",
  "experiment_id": "exp-a1b2c3d4",
  "type": "training",
  "status": "running",
  "config": { ... },
  "progress": {
    "current_step": 500,
    "total_steps": 10000,
    "current_epoch": 5,
    "total_epochs": 100,
    "percent": 5.0
  },
  "metrics": {
    "loss": 0.15,
    "learning_rate": 1e-4,
    "epoch_avg_loss": 0.18
  },
  "provenance": {
    "git_sha": "abc123def",
    "dataset_version": "1.0.0"
  },
  "started_at": "2026-01-26T10:30:05Z",
  "created_at": "2026-01-26T10:30:00Z"
}
```

#### POST /api/runs/{run_id}/cancel

Cancel a running job.

**Response (200):**
```json
{
  "id": "run-001",
  "status": "cancelled",
  "message": "Run cancelled by user"
}
```

#### GET /api/runs/{run_id}/logs

Stream training logs.

**Response (200, text/event-stream):**
```
data: {"timestamp": "2026-01-26T10:30:05Z", "level": "INFO", "message": "Starting training..."}

data: {"timestamp": "2026-01-26T10:30:06Z", "level": "INFO", "message": "Epoch 1/100 - Step 1/100 - Loss: 0.45"}
```

---

### 4.3 Evaluations

#### POST /api/runs/{run_id}/evaluate

Start evaluation on a training run.

**Request:**
```json
{
  "checkpoint": "final_model",
  "num_episodes": 10,
  "seed": 42,
  "record_video": true
}
```

**Response (201):**
```json
{
  "id": "eval-001",
  "run_id": "run-001",
  "status": "queued",
  "checkpoint": "final_model",
  "num_episodes": 10,
  "created_at": "2026-01-26T11:00:00Z"
}
```

#### GET /api/evaluations/{evaluation_id}

Get evaluation results.

**Response (200):**
```json
{
  "id": "eval-001",
  "run_id": "run-001",
  "status": "completed",
  "checkpoint": "final_model",
  "num_episodes": 10,
  "metrics": {
    "success_rate": 0.8,
    "avg_return": 150.5,
    "std_return": 25.3,
    "avg_episode_length": 200
  },
  "episodes": [
    {
      "episode_number": 1,
      "success": true,
      "total_return": 165.0,
      "episode_length": 195,
      "video_url": "/api/artifacts/vid-001/download"
    },
    {
      "episode_number": 2,
      "success": false,
      "total_return": 85.0,
      "episode_length": 250,
      "video_url": "/api/artifacts/vid-002/download"
    }
  ],
  "completed_at": "2026-01-26T11:15:00Z"
}
```

---

### 4.4 Artifacts

#### GET /api/runs/{run_id}/artifacts

List artifacts for a run.

**Response (200):**
```json
{
  "artifacts": [
    {
      "id": "art-001",
      "name": "final_model",
      "artifact_type": "checkpoint",
      "size_bytes": 157286400,
      "content_hash": "sha256:abc123...",
      "created_at": "2026-01-26T12:00:00Z"
    },
    {
      "id": "art-002",
      "name": "checkpoint_epoch_50",
      "artifact_type": "checkpoint",
      "size_bytes": 157286400,
      "content_hash": "sha256:def456...",
      "created_at": "2026-01-26T11:30:00Z"
    },
    {
      "id": "art-003",
      "name": "training_config.json",
      "artifact_type": "config",
      "size_bytes": 2048,
      "content_hash": "sha256:ghi789...",
      "created_at": "2026-01-26T10:30:00Z"
    }
  ]
}
```

#### GET /api/artifacts/{artifact_id}/download

Download artifact file.

**Response (200, application/octet-stream):**
Binary file content with headers:
- `Content-Disposition: attachment; filename="final_model.tar.gz"`
- `X-Content-Hash: sha256:abc123...`

---

### 4.5 Policies

#### GET /api/policies

List available policies.

**Response (200):**
```json
{
  "policies": [
    {
      "id": "act",
      "name": "ACT",
      "description": "Action Chunking Transformer - Predicts action sequences using transformer architecture",
      "source": "lerobot",
      "default_config": {
        "chunk_size": 100,
        "hidden_dim": 256,
        "n_heads": 8,
        "n_layers": 4
      },
      "input_modalities": ["state", "image"]
    },
    {
      "id": "diffusion",
      "name": "Diffusion Policy",
      "description": "Diffusion-based policy using denoising score matching",
      "source": "lerobot",
      "default_config": {
        "n_diffusion_steps": 100,
        "horizon": 16
      },
      "input_modalities": ["state", "image"]
    },
    {
      "id": "tdmpc",
      "name": "TD-MPC",
      "description": "Temporal Difference Model Predictive Control",
      "source": "lerobot",
      "default_config": {
        "horizon": 5,
        "iterations": 6
      },
      "input_modalities": ["state"]
    },
    {
      "id": "vqbet",
      "name": "VQ-BeT",
      "description": "Vector Quantized Behavior Transformer",
      "source": "lerobot",
      "default_config": {
        "n_clusters": 512,
        "chunk_size": 10
      },
      "input_modalities": ["state", "image"]
    }
  ]
}
```

---

### 4.6 Environments

#### GET /api/environments

List available environments.

**Response (200):**
```json
{
  "environments": [
    {
      "id": "libero",
      "name": "Libero",
      "description": "Simulation benchmark suite for robot manipulation",
      "suites": [
        {
          "id": "libero_spatial",
          "name": "Libero Spatial",
          "tasks": [
            {"id": "pick_up_the_black_bowl", "name": "Pick up the black bowl"},
            {"id": "put_the_bowl_on_the_plate", "name": "Put the bowl on the plate"}
          ]
        },
        {
          "id": "libero_object",
          "name": "Libero Object",
          "tasks": [...]
        }
      ]
    },
    {
      "id": "pusht",
      "name": "PushT",
      "description": "2D pushing task for policy learning",
      "suites": []
    }
  ]
}
```

---

## 5. Storage Layout

### 5.1 Directory Structure

```
outputs/                              # Root output directory
├── experiments/                      # Experiment data
│   └── {experiment_id}/              # e.g., exp-a1b2c3d4
│       └── runs/                     # Runs under this experiment
│           └── {run_id}/             # e.g., run-001
│               ├── config.json       # Full config snapshot
│               ├── progress.json     # Training progress (for polling)
│               ├── logs/             # Training logs
│               │   └── train.log
│               ├── checkpoints/      # Model checkpoints
│               │   ├── checkpoint_epoch_10/
│               │   │   ├── model.safetensors
│               │   │   ├── config.json
│               │   │   └── training_state.pt
│               │   ├── checkpoint_epoch_50/
│               │   └── final_model/
│               │       ├── model.safetensors
│               │       └── config.json
│               └── evaluations/      # Evaluation outputs
│                   └── {eval_id}/    # e.g., eval-001
│                       ├── config.json
│                       ├── metrics.json
│                       └── episodes/
│                           ├── episode_001/
│                           │   ├── video.mp4
│                           │   └── trajectory.npz
│                           └── episode_002/
│
└── artifacts/                        # MinIO/S3 artifact storage
    └── {artifact_id}/                # Content-addressed storage
        └── {content_hash}.tar.gz     # Artifact blob
```

### 5.2 MinIO Bucket Layout

```
urdf-studio-artifacts/                # Main artifacts bucket
├── checkpoints/
│   └── {run_id}/
│       └── {checkpoint_name}.tar.gz
├── evaluations/
│   └── {eval_id}/
│       ├── videos/
│       │   └── episode_{n}.mp4
│       └── trajectories/
│           └── episode_{n}.npz
└── configs/
    └── {run_id}/
        └── config.json

mlflow/                               # MLflow artifacts bucket
└── {experiment_id}/
    └── {run_id}/
        └── artifacts/
```

### 5.3 Naming Conventions

| Entity | ID Format | Example |
|--------|-----------|---------|
| Experiment | `exp-{uuid8}` | `exp-a1b2c3d4` |
| Run | `run-{uuid8}` | `run-e5f6g7h8` |
| Evaluation | `eval-{uuid8}` | `eval-i9j0k1l2` |
| Artifact | `art-{uuid8}` | `art-m3n4o5p6` |
| Episode | `ep-{eval_id}-{num}` | `ep-eval-001-003` |

### 5.4 Content Hashing

All artifacts stored with SHA-256 content hash for integrity:

```python
def compute_artifact_hash(file_path: Path) -> str:
    """Compute SHA-256 hash of artifact."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return f"sha256:{sha256.hexdigest()}"
```

---

## 6. Execution Model

### 6.1 Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         FastAPI Backend                             │
│                                                                     │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐              │
│  │  API Layer  │──▶│  Services   │──▶│  Job Queue  │              │
│  │             │   │             │   │  (in-memory)│              │
│  └─────────────┘   └─────────────┘   └──────┬──────┘              │
│                                             │                      │
│                          ┌──────────────────┼──────────────────┐   │
│                          ▼                  ▼                  ▼   │
│                    ┌──────────┐       ┌──────────┐      ┌──────────┐
│                    │ Worker 1 │       │ Worker 2 │      │ Worker N │
│                    │(Subprocess)      │(Subprocess)     │(Subprocess)
│                    └──────────┘       └──────────┘      └──────────┘
│                          │                  │                  │   │
└──────────────────────────┼──────────────────┼──────────────────┼───┘
                           │                  │                  │
                           ▼                  ▼                  ▼
                    ┌────────────────────────────────────────────────┐
                    │              Storage Layer                      │
                    │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
                    │  │  SQLite  │  │  MinIO   │  │  Local   │     │
                    │  │ (metadata)│  │ (artifacts) │ (temp)   │     │
                    │  └──────────┘  └──────────┘  └──────────┘     │
                    └────────────────────────────────────────────────┘
```

### 6.2 Job Lifecycle

```
                    ┌──────────┐
                    │  Created │
                    └────┬─────┘
                         │ POST /runs
                         ▼
                    ┌──────────┐
                    │  Queued  │
                    └────┬─────┘
                         │ Worker picks up
                         ▼
                    ┌──────────┐     cancel
                    │ Running  │────────────┐
                    └────┬─────┘            │
                         │                  ▼
             ┌───────────┼───────────┬──────────┐
             │           │           │          │
             ▼           ▼           ▼          │
        ┌──────────┐ ┌──────────┐ ┌──────────┐ │
        │Completed │ │  Failed  │ │Cancelled │◀┘
        └──────────┘ └──────────┘ └──────────┘
```

### 6.3 Subprocess Execution

Training and evaluation run as subprocesses to:
1. Isolate GPU memory
2. Enable cancellation
3. Prevent backend blocking
4. Allow process monitoring

```python
# backend/services/training.py

class TrainingService:
    def __init__(self):
        self._processes: Dict[str, subprocess.Popen] = {}
        self._job_store = JobStore()

    async def start_run(self, run: Run) -> str:
        """Start training subprocess."""
        # Write config to file
        config_path = run.job_dir / "config.json"
        config_path.write_text(json.dumps(run.config))

        # Start subprocess
        process = subprocess.Popen(
            [
                sys.executable,
                "-m", "backend.scripts.train_policy",
                "--config", str(config_path),
            ],
            env={
                **os.environ,
                "URDF_STUDIO_JOB_ID": run.id,
                "URDF_STUDIO_JOB_DIR": str(run.job_dir),
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        # Track process
        self._processes[run.id] = process

        # Persist to database
        await self._job_store.update_run(run.id, status="running", pid=process.pid)

        return run.id

    async def cancel_run(self, run_id: str) -> bool:
        """Cancel running job."""
        if process := self._processes.get(run_id):
            process.terminate()
            process.wait(timeout=10)
            await self._job_store.update_run(run_id, status="cancelled")
            return True
        return False
```

### 6.4 Progress Reporting

Training subprocess writes progress to file, backend polls:

```python
# backend/scripts/train_policy.py

def write_progress(job_dir: Path, step: int, total: int, metrics: dict):
    """Write progress for polling."""
    progress = {
        "current_step": step,
        "total_steps": total,
        "current_epoch": step // steps_per_epoch,
        "total_epochs": total_epochs,
        "metrics": metrics,
        "updated_at": datetime.now().isoformat(),
    }
    (job_dir / "progress.json").write_text(json.dumps(progress))
```

```python
# backend/services/training.py

async def get_run_status(self, run_id: str) -> RunStatus:
    """Get run status by polling progress file."""
    run = await self._job_store.get_run(run_id)

    progress_file = run.job_dir / "progress.json"
    if progress_file.exists():
        progress = json.loads(progress_file.read_text())
        return RunStatus(
            id=run_id,
            status=run.status,
            progress=progress,
            metrics=progress.get("metrics"),
        )

    return RunStatus(id=run_id, status=run.status)
```

### 6.5 Tracker Integration

Metrics sent to tracker from subprocess:

```python
# backend/scripts/train_policy.py

def train_with_tracker(config: dict, tracker: ExperimentTracker):
    """Training loop with tracker integration."""
    tracker.init_run(
        run_name=config["run_name"],
        config=config,
        tags={"job_id": os.environ["URDF_STUDIO_JOB_ID"]},
    )

    for epoch in range(config["epochs"]):
        for step, batch in enumerate(dataloader):
            loss = train_step(batch)

            # Log to tracker every N steps
            if step % log_interval == 0:
                tracker.log_metrics(
                    {"train/loss": loss, "train/epoch": epoch},
                    step=global_step,
                )

    tracker.finish_run("completed")
```

### 6.6 Recovery on Restart

When backend restarts, recover running jobs:

```python
# backend/services/training.py

async def recover_jobs(self):
    """Recover job state after restart."""
    running_jobs = await self._job_store.list_runs(status=["running", "queued"])

    for job in running_jobs:
        if job.status == "running":
            # Check if process is still alive
            if job.pid and is_process_running(job.pid):
                # Re-attach to process
                self._processes[job.id] = get_process(job.pid)
            else:
                # Process died, mark as failed
                await self._job_store.update_run(job.id, status="failed")

        elif job.status == "queued":
            # Re-queue the job
            await self.start_run(job)
```

---

## 7. Testing Strategy

### 7.1 Test Pyramid

```
                    ┌───────────────┐
                    │     E2E       │  1-2 tests (UI flow)
                    │   (Manual)    │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  Integration  │  10-20 tests (API + DB)
                    │    (pytest)   │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │     Unit      │  50+ tests (services, models)
                    │    (pytest)   │
                    └───────────────┘
```

### 7.2 Test Categories

| Category | Location | Runs In | Description |
|----------|----------|---------|-------------|
| Unit | `backend/tests/unit/` | CI | Fast, isolated, no GPU |
| Integration | `backend/tests/integration/` | CI | API + DB, mocked training |
| GPU | `backend/tests/gpu/` | Local only | Actual training (slow) |
| E2E | `backend/tests/e2e/` | Manual | Full browser flow |

### 7.3 Unit Tests

```python
# backend/tests/unit/test_models.py

def test_experiment_validation():
    """Test experiment model validation."""
    exp = ExperimentCreate(
        name="test-exp",
        dataset=DatasetConfig(source="huggingface", repo_id="lerobot/pusht"),
    )
    assert exp.name == "test-exp"
    assert exp.dataset.source == "huggingface"

def test_run_config_validation():
    """Test run config validation."""
    config = RunConfig(
        policy=PolicyConfig(architecture="act"),
        training=TrainingConfig(batch_size=8, epochs=10),
    )
    assert config.policy.architecture == "act"
    assert config.training.batch_size == 8
```

```python
# backend/tests/unit/test_artifact_hash.py

def test_content_hash():
    """Test artifact content hashing."""
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(b"test content")
        f.flush()

        hash_result = compute_artifact_hash(Path(f.name))
        assert hash_result.startswith("sha256:")
        assert len(hash_result) == 71  # sha256: + 64 hex chars
```

### 7.4 Integration Tests

```python
# backend/tests/integration/test_experiments_api.py

@pytest.fixture
def client():
    """Create test client with fresh database."""
    app.dependency_overrides[get_db] = get_test_db
    with TestClient(app) as client:
        yield client

def test_create_experiment(client):
    """Test experiment creation via API."""
    response = client.post("/api/experiments", json={
        "name": "test-experiment",
        "dataset": {"source": "huggingface", "repo_id": "lerobot/pusht"},
    })

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "test-experiment"
    assert data["id"].startswith("exp-")

def test_start_run(client, experiment_id):
    """Test starting a training run."""
    response = client.post(
        f"/api/experiments/{experiment_id}/runs",
        json={
            "type": "training",
            "config": {
                "policy": {"architecture": "act"},
                "training": {"batch_size": 8, "epochs": 1},
            },
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "queued"
```

### 7.5 GPU Tests (Local Only)

```python
# backend/tests/gpu/test_training.py

@pytest.mark.gpu
@pytest.mark.slow
def test_pusht_training():
    """Test actual training on PushT dataset."""
    config = {
        "dataset": {"source": "huggingface", "repo_id": "lerobot/pusht"},
        "policy": {"architecture": "act"},
        "training": {"batch_size": 4, "epochs": 1, "seed": 42},
    }

    # Run training subprocess
    result = subprocess.run(
        [sys.executable, "-m", "backend.scripts.train_policy", "--config", config_path],
        capture_output=True,
        timeout=600,
    )

    assert result.returncode == 0
    assert (output_dir / "final_model" / "model.safetensors").exists()
```

### 7.6 CI Configuration

```yaml
# .github/workflows/test.yml

name: Tests

on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install dependencies
        run: |
          pip install uv
          uv pip install -e ".[dev]"
      - name: Run unit tests
        run: pytest backend/tests/unit/ -v --tb=short

  integration:
    runs-on: ubuntu-latest
    services:
      minio:
        image: minio/minio:RELEASE.2024-01-16T16-07-38Z
        ports:
          - 9000:9000
        env:
          MINIO_ROOT_USER: minioadmin
          MINIO_ROOT_PASSWORD: minioadmin
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install dependencies
        run: |
          pip install uv
          uv pip install -e ".[dev]"
      - name: Run integration tests
        run: pytest backend/tests/integration/ -v --tb=short
        env:
          S3_ENDPOINT_URL: http://localhost:9000
          S3_ACCESS_KEY: minioadmin
          S3_SECRET_KEY: minioadmin
```

### 7.7 Manual E2E Checklist

```markdown
## E2E Test: Full Training Flow

### Prerequisites
- [ ] Docker Compose stack running (`docker compose up -d`)
- [ ] MLflow accessible at http://localhost:5000
- [ ] MinIO accessible at http://localhost:9001

### Test Steps

1. **Create Experiment**
   - [ ] Open http://localhost:5173
   - [ ] Click "New Experiment"
   - [ ] Enter name: "e2e-test-pusht"
   - [ ] Select HuggingFace dataset: "lerobot/pusht"
   - [ ] Click "Create"
   - [ ] Verify experiment appears in list

2. **Start Training**
   - [ ] Click on experiment "e2e-test-pusht"
   - [ ] Click "New Run"
   - [ ] Select policy: "ACT"
   - [ ] Set epochs: 2, batch_size: 4
   - [ ] Select tracker: "MLflow"
   - [ ] Click "Start"
   - [ ] Verify run appears with status "running"

3. **Monitor Progress**
   - [ ] Watch progress bar update
   - [ ] Verify loss curve updates in real-time
   - [ ] Check MLflow UI shows metrics

4. **Run Evaluation**
   - [ ] Wait for training to complete
   - [ ] Click "Evaluate" on completed run
   - [ ] Set num_episodes: 3
   - [ ] Click "Start"
   - [ ] Wait for evaluation to complete

5. **View Results**
   - [ ] Open evaluation results
   - [ ] Verify metrics shown (success_rate, avg_return)
   - [ ] Click on episode to watch video
   - [ ] Verify video plays correctly

6. **Download Artifacts**
   - [ ] Go to Artifacts tab
   - [ ] Click "Download" on final_model
   - [ ] Verify file downloads with correct hash
```

---

## 8. Implementation Plan

### 8.1 PR Breakdown

| PR | Title | Dependencies | Priority |
|----|-------|--------------|----------|
| PR1 | Schema & Migrations | None | P0 |
| PR2 | Experiments CRUD | PR1 | P0 |
| PR3 | Runs & Training | PR2 | P0 |
| PR4 | Artifact Storage | PR1 | P0 |
| PR5 | Policy Discovery | None | P1 |
| PR6 | Evaluations | PR3, PR4 | P1 |
| PR7 | Video Playback | PR6 | P1 |
| PR8 | Frontend Dashboard | PR2, PR3 | P1 |
| PR9 | Integration Tests | All above | P2 |

### 8.2 PR Details

#### PR1: Schema & Migrations
**Files:**
- `backend/services/migrations.py` - Migration runner
- `backend/migrations/001_robotmlops_core.py` - Initial schema
- `backend/services/database.py` - SQLite connection management

**Acceptance:**
- [ ] Migrations run on app startup
- [ ] Tables created correctly
- [ ] Rollback works

---

#### PR2: Experiments CRUD
**Files:**
- `backend/models/experiments.py` - Pydantic models
- `backend/api/experiments.py` - API routes
- `backend/services/experiments.py` - Business logic

**Acceptance:**
- [ ] POST /experiments creates experiment
- [ ] GET /experiments lists experiments
- [ ] GET /experiments/{id} returns details
- [ ] DELETE /experiments/{id} deletes experiment

---

#### PR3: Runs & Training
**Files:**
- `backend/models/runs.py` - Run models
- `backend/api/runs.py` - Run routes
- `backend/services/training.py` - Training service (refactor)
- `backend/scripts/train_policy.py` - Training subprocess (refactor)

**Acceptance:**
- [ ] POST /experiments/{id}/runs starts training
- [ ] GET /runs/{id} returns status + progress
- [ ] POST /runs/{id}/cancel cancels job
- [ ] Tracker integration works

---

#### PR4: Artifact Storage
**Files:**
- `backend/models/artifacts.py` - Artifact models
- `backend/api/artifacts.py` - Artifact routes
- `backend/services/artifact_storage.py` - Storage abstraction (enhance)

**Acceptance:**
- [ ] Artifacts stored with content hash
- [ ] GET /runs/{id}/artifacts lists artifacts
- [ ] GET /artifacts/{id}/download returns file
- [ ] Works with local and MinIO backends

---

#### PR5: Policy Discovery
**Files:**
- `backend/robotops/policies/registry.py` - Policy registry
- `backend/robotops/policies/lerobot_adapter.py` - LeRobot adapter
- `backend/api/policies.py` - Policy routes

**Acceptance:**
- [ ] GET /policies returns discovered policies
- [ ] Policies include default configs
- [ ] No hardcoded imports in training code

---

#### PR6: Evaluations
**Files:**
- `backend/models/evaluations.py` - Evaluation models
- `backend/api/evaluations.py` - Evaluation routes
- `backend/services/evaluation.py` - Evaluation service
- `backend/scripts/eval_policy.py` - Eval subprocess (enhance)

**Acceptance:**
- [ ] POST /runs/{id}/evaluate starts evaluation
- [ ] GET /evaluations/{id} returns results
- [ ] Metrics stored in DB
- [ ] Videos stored in MinIO

---

#### PR7: Video Playback
**Files:**
- `web/src/features/evaluation/EpisodePlayer.tsx` - Video player
- `web/src/features/evaluation/EvaluationResults.tsx` - Results view

**Acceptance:**
- [ ] Video player with controls
- [ ] Episode list with metrics
- [ ] Click episode to play video

---

#### PR8: Frontend Dashboard
**Files:**
- `web/src/features/experiments/ExperimentDashboard.tsx`
- `web/src/features/experiments/ExperimentList.tsx`
- `web/src/features/experiments/ExperimentDetails.tsx`
- `web/src/features/experiments/CreateExperimentDialog.tsx`
- `web/src/features/experiments/StartRunDialog.tsx`
- `web/src/features/experiments/useExperimentStore.ts`
- `web/src/features/metrics/LossCurve.tsx`

**Acceptance:**
- [ ] Experiment list view
- [ ] Create experiment dialog
- [ ] Run list with status
- [ ] Start run dialog
- [ ] Loss curve visualization

---

#### PR9: Integration Tests
**Files:**
- `backend/tests/integration/test_experiments_api.py`
- `backend/tests/integration/test_runs_api.py`
- `backend/tests/integration/test_evaluations_api.py`
- `backend/tests/integration/test_artifacts_api.py`

**Acceptance:**
- [ ] All API endpoints tested
- [ ] CI runs integration tests
- [ ] Coverage > 80%

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Experiment** | A named grouping of runs sharing the same dataset and environment configuration |
| **Run** | A single training or evaluation execution within an experiment |
| **Artifact** | Any file produced by a run (checkpoints, configs, videos, logs) |
| **Evaluation** | Running a trained policy in simulation to measure performance |
| **Episode** | A single rollout of policy execution in an environment |
| **Checkpoint** | Saved model weights at a specific training step |
| **Provenance** | The full lineage of a run (code version, dataset version, config) |

---

## Appendix B: Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HF_TOKEN` | HuggingFace API token | - |
| `MLFLOW_TRACKING_URI` | MLflow server URL | `http://localhost:5000` |
| `WANDB_API_KEY` | Weights & Biases API key | - |
| `S3_ENDPOINT_URL` | MinIO/S3 endpoint | `http://localhost:9000` |
| `S3_ACCESS_KEY` | MinIO/S3 access key | `minioadmin` |
| `S3_SECRET_KEY` | MinIO/S3 secret key | `minioadmin` |
| `S3_BUCKET` | Artifacts bucket name | `artifacts` |
| `OUTPUT_DIR` | Local output directory | `./outputs` |
| `DEFAULT_SEED` | Default random seed | `42` |

---

## Appendix C: References

- [LeRobot Documentation](https://huggingface.co/docs/lerobot)
- [Libero Benchmark](https://libero-project.github.io/)
- [MLflow Documentation](https://mlflow.org/docs/latest/index.html)
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
