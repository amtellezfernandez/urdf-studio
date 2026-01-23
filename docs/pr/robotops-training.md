# PR: RobotOps Training Pipeline for URDF Studio

> **Branch**: `feature/robotops-training`
> **Epic**: Transform URDF Studio into a full Robot Learning Operations platform

---

## Executive Summary

Add end-to-end robot learning capabilities: dataset selection, model training, experiment tracking (MLflow/W&B), and policy evaluation in the existing 3D viewer.

---

## Competitive Analysis

### Market Landscape (2025-2026)

| Platform | Focus | Strengths | Gaps |
|----------|-------|-----------|------|
| **[Foxglove](https://foxglove.dev/)** | Visualization + Data Platform | $40M Series B, ROS integration, team collaboration, MCAP format | No training orchestration, visualization-only |
| **[Rerun](https://rerun.io/)** | Visualization + Training Data | $17M seed, open source core, HuggingFace/LeRobot integration | Early stage, limited training workflow |
| **[NVIDIA Isaac](https://developer.nvidia.com/isaac)** | Simulation + Training | Full stack, cloud (AWS/GCP), OSMO orchestration | Heavy, requires NVIDIA stack, high barrier |
| **[LeRobot](https://github.com/huggingface/lerobot)** | Datasets + Policies | Open source, HuggingFace ecosystem, standardized format | CLI-only, no integrated training UI |
| **[ROBOTIS](https://ai.robotis.com/)** | Hardware + Training UI | Web UI for LeRobot training | Single vendor, limited flexibility |

### Key Insights

1. **No unified "RobotOps" platform exists** - The term isn't widely used yet; opportunity to define the category
2. **Visualization is solved** - Foxglove, Rerun both strong here; don't compete directly
3. **Training orchestration is fragmented** - Users piece together MLflow + cloud + LeRobot CLI manually
4. **LeRobot is the standard** - HuggingFace's dataset format is becoming the norm; build on it, don't replace it
5. **Cloud training is coming** - NVIDIA OSMO, AWS Isaac Sim show direction; serverless GPU (Modal/RunPod) more accessible

### URDF Studio Differentiation

**Position**: The first accessible, web-based Robot Learning Studio that combines:
- URDF visualization (existing) + dataset management (existing)
- Training orchestration with plug-and-play backends (compute + tracking)
- Policy evaluation in the same 3D viewer users already use

**Unique Value**:
1. **Single pane of glass** - Don't context-switch between tools
2. **LeRobot native** - Works with existing ecosystem, doesn't replace it
3. **Plug-and-play** - MLflow OR W&B, Local OR Modal OR RunPod
4. **Visual eval** - See your trained policy in 3D immediately
5. **Accessible** - No NVIDIA stack required, runs on any hardware

### Competitive Positioning Map

```
                    Training Orchestration
                           ▲
                           │
    URDF Studio ──────────►│ ◄──── NVIDIA Isaac
    (target position)      │       (enterprise)
                           │
                           │
    ROBOTIS ──────────────►│
    (basic)                │
                           │
──────────────────────────►├────────────────────────────►
   Visualization Only      │        Full MLOps
                           │
    Foxglove ─────────────►│
    Rerun ────────────────►│
                           │
    LeRobot ──────────────►│ (CLI, no UI)
                           │
                           ▼
```

---

## Deliverables Overview

| # | Deliverable | Priority | Status |
|---|-------------|----------|--------|
| D1 | Experiment Tracker Protocol (Plug-and-Play) | P0 | Pending |
| D2 | Training Backend API + Cloud Compute | P0 | Pending |
| D3 | Training Frontend UI | P0 | Pending |
| D4 | Policy Evaluation | P1 | Pending |
| D5 | Integration & Polish | P1 | Pending |

## Key Decisions

- **Compute**: Local GPU + Cloud (Modal/RunPod) from day one
- **Models**: All LeRobot native models first (ACT, Diffusion Policy, TDMPC, VQ-BeT)
- **Tracking**: Protocol-based abstraction - plug any tracker (MLflow, W&B, Neptune, custom)

---

## User Stories

### US-1: Dataset Selection for Training
**As a** robotics researcher
**I want to** select a dataset from HuggingFace or local storage
**So that** I can train on my demonstrations

**Acceptance Criteria**:
- [ ] Browse HuggingFace datasets with search
- [ ] Select local LeRobot v3 folders
- [ ] Display dataset metadata (episodes, robot_type, fps)
- [ ] Validate dataset before training

---

### US-2: Model Selection
**As a** researcher
**I want to** choose from LeRobot policy architectures
**So that** I can experiment with different approaches

**Acceptance Criteria**:
- [ ] Select from LeRobot models: ACT, Diffusion Policy, TDMPC, VQ-BeT
- [ ] Import custom model configs (YAML)
- [ ] Show model-specific parameters per architecture
- [ ] Provide sensible defaults from LeRobot
- [ ] Extensible for future models (SmolVLA, OpenVLA)

---

### US-3: Training Configuration
**As a** researcher
**I want to** configure hyperparameters
**So that** I can tune model performance

**Acceptance Criteria**:
- [ ] Configure: batch_size, learning_rate, epochs
- [ ] Configure: checkpoint_interval, early_stopping
- [ ] Validate inputs before launch

---

### US-4: Launch & Monitor Training
**As a** researcher
**I want to** start training and see progress
**So that** I know the status

**Acceptance Criteria**:
- [ ] Start training with button click
- [ ] Show progress bar (epoch/step)
- [ ] Display live metrics (loss, lr)
- [ ] Cancel running jobs
- [ ] Notification on completion

---

### US-4b: Compute Backend Selection
**As a** researcher
**I want to** choose where training runs (local or cloud)
**So that** I can scale beyond my hardware

**Acceptance Criteria**:
- [ ] Select compute: Local GPU, Modal, RunPod
- [ ] Configure cloud credentials (API keys)
- [ ] Show estimated cost for cloud runs
- [ ] Stream logs from remote jobs
- [ ] Download checkpoints from cloud storage

---

### US-5: Experiment Tracking
**As a** researcher
**I want to** track experiments in MLflow or W&B
**So that** I can compare runs

**Acceptance Criteria**:
- [ ] Select tracker: MLflow, W&B, or None
- [ ] Configure tracker (URI, project name)
- [ ] Log metrics, params, artifacts
- [ ] Display run URL after start

---

### US-6: Policy Evaluation in Viewer
**As a** researcher
**I want to** load a trained policy and visualize inference
**So that** I can verify learned behavior

**Acceptance Criteria**:
- [ ] Load checkpoint (.pt, .safetensors)
- [ ] Run inference on observations
- [ ] Replay predicted actions in 3D viewer
- [ ] Step frame-by-frame or auto-play

---

### US-7: Training Lineage
**As a** researcher
**I want to** know which dataset/config produced each model
**So that** I can reproduce experiments

**Acceptance Criteria**:
- [ ] Record: dataset_id, model_type, full_config
- [ ] Save lineage JSON with checkpoint
- [ ] Log to experiment tracker
- [ ] Display lineage in UI

---

## Technical Architecture

### Backend Structure (New Files)

```
backend/
├── api/
│   └── training.py              # POST /training/start, GET /training/status/{id}, etc.
├── models/
│   └── training.py              # TrainingRequest, TrainingStatus, etc.
├── services/
│   ├── training.py              # Subprocess orchestration
│   └── experiment_tracker.py    # Protocol + MLflow/W&B implementations
└── scripts/
    ├── train_policy.py          # Training subprocess entry point
    └── eval_policy.py           # Inference subprocess
```

### Frontend Structure (New Files)

```
web/src/features/training/
├── index.ts
├── types.ts
├── useTrainingStore.ts          # Zustand store
├── TrainingDialog.tsx           # Main dialog
├── DatasetSelector.tsx          # HF browser + local picker
├── ModelSelector.tsx            # Model dropdown + config
├── HyperparameterForm.tsx       # Training params form
├── TrackerConfig.tsx            # MLflow/W&B config
├── TrainingProgress.tsx         # Progress bar + metrics
└── PolicyEvaluator.tsx          # Inference UI
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/training/start` | Start training job |
| GET | `/training/status/{job_id}` | Poll job status |
| POST | `/training/cancel/{job_id}` | Cancel job |
| GET | `/training/jobs` | List all jobs |
| POST | `/training/evaluate` | Run policy inference |
| GET | `/training/models` | List model architectures |

---

## Implementation Plan

### Phase 1: Experiment Tracker Protocol (Plug-and-Play)
**Files to create:**
- `backend/robotops/__init__.py`
- `backend/robotops/tracker_protocol.py`
- `backend/robotops/trackers/mlflow_tracker.py`
- `backend/robotops/trackers/wandb_tracker.py`
- `backend/robotops/trackers/noop_tracker.py`
- `backend/robotops/tracker_factory.py`

**Protocol Design (ZenML-inspired):**
```python
# backend/robotops/tracker_protocol.py
from typing import Protocol, Dict, Any, Optional, runtime_checkable
from pathlib import Path

@runtime_checkable
class ExperimentTracker(Protocol):
    """Plug-and-play experiment tracking interface.

    Implement this protocol to add support for any tracking backend.
    """

    @property
    def name(self) -> str:
        """Tracker identifier (e.g., 'mlflow', 'wandb', 'neptune')"""
        ...

    def init_run(self, run_name: str, config: Dict[str, Any], tags: Dict[str, str] = None) -> str:
        """Initialize tracking run, return run_id"""
        ...

    def log_params(self, params: Dict[str, Any]) -> None:
        """Log hyperparameters"""
        ...

    def log_metrics(self, metrics: Dict[str, float], step: int) -> None:
        """Log metrics at step"""
        ...

    def log_artifact(self, path: Path, artifact_name: str = None) -> None:
        """Log file artifact (checkpoint, config, etc.)"""
        ...

    # Robot-specific extensions
    def log_dataset_lineage(self, dataset_id: str, version: str, source: str) -> None:
        """Log dataset used for training"""
        ...

    def log_model_config(self, architecture: str, config: Dict[str, Any]) -> None:
        """Log model architecture and config"""
        ...

    def finish_run(self, status: str = "completed") -> None:
        """Finalize the run"""
        ...

    def get_run_url(self) -> Optional[str]:
        """Get URL to view the run (if applicable)"""
        ...


# backend/robotops/tracker_factory.py
def get_tracker(config: TrackerConfig) -> ExperimentTracker:
    """Factory to instantiate tracker based on config."""
    trackers = {
        "mlflow": MLflowTracker,
        "wandb": WandBTracker,
        "neptune": NeptuneTracker,  # Future
        "none": NoopTracker,
    }
    tracker_cls = trackers.get(config.type, NoopTracker)
    return tracker_cls(**config.dict(exclude={"type"}))
```

**Implementations:**
```python
# backend/robotops/trackers/mlflow_tracker.py
class MLflowTracker:
    name = "mlflow"

    def __init__(self, tracking_uri: str = None, experiment_name: str = None):
        import mlflow
        if tracking_uri:
            mlflow.set_tracking_uri(tracking_uri)
        if experiment_name:
            mlflow.set_experiment(experiment_name)
        self._run = None

# backend/robotops/trackers/wandb_tracker.py
class WandBTracker:
    name = "wandb"

    def __init__(self, project: str, entity: str = None, **kwargs):
        import wandb
        self._project = project
        self._entity = entity

# backend/robotops/trackers/noop_tracker.py
class NoopTracker:
    """No-op tracker for local-only runs. Logs to console/file."""
    name = "none"
```

---

### Phase 1b: Compute Backend Protocol
**Files to create:**
- `backend/robotops/compute_protocol.py`
- `backend/robotops/compute/local_compute.py`
- `backend/robotops/compute/modal_compute.py`
- `backend/robotops/compute/runpod_compute.py`
- `backend/robotops/compute_factory.py`

**Protocol Design:**
```python
# backend/robotops/compute_protocol.py
from typing import Protocol, Dict, Any, Optional, AsyncIterator
from dataclasses import dataclass

@dataclass
class JobStatus:
    job_id: str
    status: str  # pending, running, completed, failed, cancelled
    progress: Optional[float] = None
    metrics: Optional[Dict[str, float]] = None
    logs: Optional[str] = None

@runtime_checkable
class ComputeBackend(Protocol):
    """Plug-and-play compute backend interface."""

    @property
    def name(self) -> str:
        """Backend identifier (e.g., 'local', 'modal', 'runpod')"""
        ...

    async def launch(self, script: str, config: Dict[str, Any]) -> str:
        """Launch training job, return job_id"""
        ...

    async def status(self, job_id: str) -> JobStatus:
        """Get job status"""
        ...

    async def logs(self, job_id: str) -> AsyncIterator[str]:
        """Stream logs from job"""
        ...

    async def cancel(self, job_id: str) -> bool:
        """Cancel running job"""
        ...

    async def download_artifacts(self, job_id: str, dest: Path) -> List[Path]:
        """Download checkpoints/artifacts from job"""
        ...

    def estimate_cost(self, config: Dict[str, Any]) -> Optional[float]:
        """Estimate cost in USD (None for local)"""
        ...


# backend/robotops/compute/local_compute.py
class LocalCompute:
    name = "local"

    async def launch(self, script: str, config: Dict[str, Any]) -> str:
        # Use subprocess.Popen for non-blocking
        ...

# backend/robotops/compute/modal_compute.py
class ModalCompute:
    name = "modal"

    def __init__(self, api_key: str = None):
        import modal
        ...

# backend/robotops/compute/runpod_compute.py
class RunPodCompute:
    name = "runpod"

    def __init__(self, api_key: str = None):
        import runpod
        ...
```

---

### Phase 2: Training Backend API
**Files to create:**
- `backend/models/training.py`
- `backend/api/training.py`
- `backend/services/training.py`
- `backend/scripts/train_policy.py`

**Modify:**
- `backend/app.py` (add training_router)

**Key patterns (from datasets.py):**
```python
# Subprocess pattern for long-running training
result = subprocess.run(
    ["python3", str(script_path), "--config", config_json],
    capture_output=True,
    text=True,
    timeout=training_timeout,
)
```

**Pydantic Models:**
```python
class DatasetConfig(BaseModel):
    source: Literal["huggingface", "local"]
    repo_id: Optional[str] = None
    local_path: Optional[str] = None

class ModelConfig(BaseModel):
    architecture: Literal["smolvla", "act", "diffusion_policy", "custom"]
    config: Dict[str, Any] = {}

class TrainingParams(BaseModel):
    batch_size: int = 32
    learning_rate: float = 1e-4
    epochs: int = 100
    checkpoint_interval: int = 10
    output_dir: str = "./outputs"

class TrackerConfig(BaseModel):
    type: Literal["mlflow", "wandb", "none"] = "none"
    tracking_uri: Optional[str] = None
    project: Optional[str] = None

class TrainingStartRequest(BaseModel):
    dataset: DatasetConfig
    model: ModelConfig
    training: TrainingParams
    tracker: TrackerConfig = TrackerConfig()

class TrainingStatusResponse(BaseModel):
    job_id: str
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    progress: Optional[TrainingProgress] = None
    metrics: Optional[Dict[str, float]] = None
    tracker_url: Optional[str] = None
    lineage: TrainingLineage
```

---

### Phase 3: Training Frontend UI
**Files to create:**
- `web/src/features/training/` (all components)

**Modify:**
- `web/src/features/layout/page/TopNavBar.tsx` (add Training menu)
- `web/src/features/layout/page/PageDialogs.tsx` (add TrainingDialog)

**Zustand Store:**
```typescript
interface TrainingState {
  isDialogOpen: boolean;
  activeJobId: string | null;
  jobStatus: TrainingStatusResponse | null;
  config: {
    dataset: DatasetConfig | null;
    model: ModelConfig | null;
    training: TrainingParams;
    tracker: TrackerConfig;
  };
  // Actions
  openDialog: () => void;
  closeDialog: () => void;
  setDataset: (dataset: DatasetConfig) => void;
  setModel: (model: ModelConfig) => void;
  startTraining: () => Promise<void>;
  cancelTraining: () => Promise<void>;
}
```

**UI Components (following ExportDialog.tsx pattern):**
- Use Radix UI Dialog
- BlenderPanel for sections
- Form validation with state
- Async operations with loading states

---

### Phase 4: Policy Evaluation
**Files to create:**
- `backend/scripts/eval_policy.py`
- `web/src/features/training/PolicyEvaluator.tsx`

**Integration with viewer:**
- Use existing `useViewerPlaybackStore` for action playback
- Load checkpoint, run inference, get action sequence
- Feed actions to playback system

---

### Phase 5: Integration & Polish
**Tasks:**
- Add Training item to TopNavBar dropdown
- Connect experiment list to checkpoint browser
- Add keyboard shortcuts
- Write tests
- Update documentation

---

## Files to Modify (Summary)

| File | Change |
|------|--------|
| `backend/app.py` | Add `training_router` |
| `web/src/features/layout/page/TopNavBar.tsx` | Add Training menu item |
| `web/src/features/layout/page/PageDialogs.tsx` | Add TrainingDialog |
| `config/app.config.json` | Add training config section |
| `pyproject.toml` | Add mlflow, wandb dependencies |
| `package.json` | No changes (UI libs already present) |

---

## Verification Plan

### Backend Tests
1. **Unit**: Pydantic model validation
2. **Integration**: Subprocess spawning, status polling
3. **E2E**: Full training with mock LeRobot

### Frontend Tests
1. **Component**: Dialog renders, form validation
2. **Integration**: API calls, state updates

### Manual Testing Checklist
- [ ] Select HF dataset `lerobot/aloha_sim_insertion`
- [ ] Configure ACT model with defaults
- [ ] Start training with W&B tracker
- [ ] Verify metrics appear in W&B dashboard
- [ ] Cancel training mid-run
- [ ] Load checkpoint and run eval
- [ ] Verify actions replay in 3D viewer

---

## Dependencies to Add

**Python (pyproject.toml):**
```toml
[project.optional-dependencies]
training = [
    "mlflow>=2.10.0",
    "wandb>=0.16.0",
    "lerobot>=0.1.0",  # or use vendor
]
```

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Long training times block API | Subprocess isolation (existing pattern) |
| GPU memory issues | Document requirements, add checks |
| LeRobot API changes | Pin version, abstract access |
| Tracker auth failures | Graceful fallback to NoopTracker |

---

## Out of Scope (Future Work / V2)

- Distributed multi-GPU training
- Model serving/deployment (NVIDIA Triton, TorchServe)
- Real robot execution from UI (teleoperation exists, but not training→deploy flow)
- Dataset augmentation tools (sim2real, domain randomization)
- Simulation integration (Isaac Sim, MuJoCo, PyBullet)
- Team collaboration features (shared experiments, access control)

---

## Product Roadmap

### V1.0 - Training Studio (This PR)
- Training UI with dataset/model/config selection
- Local + Cloud compute (Modal, RunPod)
- Experiment tracking (MLflow, W&B)
- Policy evaluation in 3D viewer
- LeRobot model support (ACT, Diffusion Policy, TDMPC, VQ-BeT)

### V1.1 - Extended Models
- SmolVLA, OpenVLA support
- Custom model import (HuggingFace model cards)
- Fine-tuning from pretrained checkpoints

### V1.2 - Simulation Integration
- Isaac Sim connector
- MuJoCo environment support
- Sim-to-real gap visualization

### V2.0 - Collaboration
- Team workspaces
- Shared experiments
- Model registry with versioning
- Deployment pipelines
