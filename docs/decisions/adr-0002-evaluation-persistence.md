# ADR-0002: Evaluation Persistence Strategy

**Status:** Accepted
**Date:** 2026-01-26
**Deciders:** @charbel
**Tags:** `core`, `v0.1`

## Context

Currently, evaluations are ephemeral - results displayed once and lost on refresh. Users need:
- Persistent evaluation metrics for comparison
- Episode-level breakdown (success, return, length)
- Video artifacts for qualitative assessment

## Decision

### Data Model

```
Evaluation
├── id (UUID)
├── run_id (FK → training run)
├── checkpoint_name
├── num_episodes
├── seed
├── status (queued/running/completed/failed)
├── metrics (JSON: success_rate, avg_return, std_return, avg_length)
├── started_at, completed_at
└── episodes[]

Episode
├── id (UUID)
├── evaluation_id (FK)
├── episode_number
├── success (boolean)
├── total_return (float)
├── episode_length (int)
├── video_artifact_id (FK → artifact, nullable)
└── trajectory_artifact_id (FK → artifact, nullable)
```

### Storage Strategy

| Data Type | Storage | Rationale |
|-----------|---------|-----------|
| Metrics | SQLite | Fast queries, aggregation |
| Config | SQLite (JSON) | Reproducibility |
| Videos | MinIO/Local FS | Large binary files |
| Trajectories | MinIO/Local FS | Large arrays (npz) |

### Video Generation (v0.1)

For v0.1, videos are **best-effort from observation frames**:
- If dataset has `observation.images.*` keys, stitch into MP4
- If no images, skip video (metrics-only evaluation)
- Sim-rendered videos deferred to v0.3

## Consequences

### Positive
- Evaluations survive restart
- Can compare evaluations across runs
- Episode-level granularity for debugging

### Negative
- Storage growth (videos are large)
- Need artifact cleanup policy

### Neutral
- Aligns with MLflow artifact pattern

## Alternatives Considered

1. **Store everything in SQLite (BLOBs)**
   - Rejected: DB size explosion, no streaming

2. **Pure file-based (no DB)**
   - Rejected: Slow queries, no indexing

3. **External object storage only (S3)**
   - Deferred: Local-first for v0.1, S3 in v0.2

## Implementation

- `backend/models/evaluations.py` - Pydantic schemas
- `backend/api/evaluations.py` - Endpoints
- `backend/services/evaluation.py` - Orchestration
- `backend/scripts/eval_policy.py` - Subprocess (enhanced)
- Migration: `001_evaluations_table.py`
