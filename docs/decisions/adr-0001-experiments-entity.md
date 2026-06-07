# ADR-0001: Experiments as First-Class Entity

**Status:** Accepted
**Date:** 2026-01-26
**Deciders:** @charbel
**Tags:** `core`, `v0.1`

## Context

The existing training system stores jobs independently without grouping. Users need to:
- Group related training runs (e.g., "all ACT runs on PushT dataset")
- Pin dataset versions for reproducibility
- Compare runs within a logical experiment

## Decision

Introduce **Experiment** as a first-class entity that groups runs under a shared context:

```
Experiment
├── name (unique)
├── description
├── dataset_config (source, repo_id, version, resolved_commit_sha)
├── environment_config (optional, for v0.3)
├── robot_config (URDF reference)
└── runs[] (training + evaluation)
```

### Key Design Choices

1. **Dataset pinned at experiment creation**
   - HuggingFace dataset version resolved to commit SHA immediately
   - All runs in experiment use the same data

2. **Environment is optional in v0.1**
   - Placeholder field `environment_config` stored as JSON
   - Becomes first-class in v0.3 for Libero integration

3. **Runs belong to exactly one experiment**
   - No orphan runs (existing jobs migrated to "default" experiment)
   - Cascade delete: deleting experiment deletes all runs

4. **Naming is unique**
   - Experiment names are unique per installation
   - Prevents confusion when exporting to HF Hub

## Consequences

### Positive
- Clear hierarchy: Experiment → Run → Evaluation → Episode
- Reproducibility: dataset version locked at experiment creation
- Better organization in UI (experiment list → run list)

### Negative
- Migration needed for existing jobs
- Slightly more complex API (nested routes)

### Neutral
- Aligns with MLflow/W&B mental model (experiment contains runs)

## Alternatives Considered

1. **Tags instead of experiments**
   - Rejected: Too unstructured, doesn't enforce dataset consistency

2. **Projects containing experiments**
   - Deferred: Added complexity for v0.1, consider for v1.0 multi-user

## Implementation

- `backend/models/experiments.py` - Pydantic schemas
- `backend/api/experiments.py` - CRUD endpoints
- `backend/services/experiments.py` - Business logic
- Migration: `001_experiments_entity.py`
