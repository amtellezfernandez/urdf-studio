# ADR-0003: HuggingFace Hub as Remote Model Registry

**Status:** Accepted
**Date:** 2026-01-26
**Deciders:** @charbel
**Tags:** `hf`, `v0.1`

## Context

Users need to:
- Export trained models for sharing/deployment
- Version models with metadata
- Discover and load models later

Building a full model registry is complex (versioning, stages, approvals, storage). HuggingFace Hub already provides this infrastructure.

## Decision

**Use HuggingFace Hub as the remote model registry for v0.1-v0.2.**

### Export Flow

```
Training Run (completed)
    │
    ▼
Export to HF Hub
    │
    ├── model.safetensors (weights)
    ├── config.json (architecture config)
    ├── training_config.json (hyperparameters)
    └── README.md (auto-generated model card)
```

### Model Card Contents

```markdown
# {model_name}

## Model Details
- **Architecture:** ACT
- **Dataset:** lerobot/pusht @ abc123
- **Training Epochs:** 100
- **Final Loss:** 0.05

## Training Configuration
- Batch Size: 8
- Learning Rate: 1e-4
- Seed: 42

## Provenance
- **URDF Studio Run ID:** run-abc123
- **Experiment:** pusht-act-baseline
- **Trained:** 2026-01-26T10:00:00Z

## Usage
```python
from lerobot import load_policy
policy = load_policy("username/model-name")
```
```

### Metadata Strategy

| Field | Location | Purpose |
|-------|----------|---------|
| run_id | Model card + tags | Link back to URDF Studio |
| experiment_id | Model card | Grouping |
| dataset_commit | Model card + config | Reproducibility |
| architecture | config.json | Loading |
| training_config | training_config.json | Reproducibility |

### Versioning

- HuggingFace uses git-based versioning (commits)
- We add **tags** for semantic versioning: `v1.0.0`, `latest`, `best`
- Tags include run_id: `run-abc123`

## Consequences

### Positive
- Zero infrastructure to build/maintain
- Built-in versioning, access control, CDN
- Ecosystem integration (transformers, lerobot, etc.)
- Community discovery

### Negative
- Dependency on external service
- Public by default (private requires Pro account)
- Limited custom metadata fields

### Neutral
- Aligns with LeRobot ecosystem
- Standard practice in ML community

## Alternatives Considered

1. **Build custom model registry**
   - Deferred to v0.4+: significant effort, HF sufficient for now

2. **MLflow Model Registry**
   - Rejected: Less ecosystem integration, separate UI

3. **S3/MinIO with manual versioning**
   - Rejected: No discovery, no model cards, no access control

## Migration Path

When/if we build a custom registry (v0.4+):
- Import from HF Hub as source of truth
- Maintain HF export as publishing mechanism
- Add local registry for staging/governance

## Implementation

- `backend/services/hf_export.py` - Export logic
- `backend/api/models.py` - `POST /runs/{id}/export-to-hf`
- Model card template: `backend/templates/model_card.md`
