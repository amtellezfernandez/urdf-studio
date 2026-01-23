# URDF Studio SDK - AI Agent Quick Reference

## Installation

The SDK is part of the URDF Studio backend. No separate installation needed.

```python
from backend.sdk import URDFStudioClient
```

## Quick Start

```python
import asyncio
from backend.sdk import URDFStudioClient

async def main():
    async with URDFStudioClient("http://localhost:8000") as client:
        # Your code here
        pass

asyncio.run(main())
```

## Common Operations

### 1. Health Check
```python
health = await client.health.check()
is_ok = await client.health.is_healthy()  # Returns bool
```

### 2. List Available Models
```python
models = await client.training.list_models()
for m in models:
    print(f"{m.name}: {m.description}")
```

### 3. Start Training
```python
job = await client.training.start(
    dataset="lerobot/pusht",  # HuggingFace dataset
    model="act",              # act, diffusion_policy, tdmpc, vq_bet
    epochs=100,
    batch_size=32,
    compute="local",          # local, modal, runpod
)
print(f"Job ID: {job.job_id}")
```

### 4. Monitor Training
```python
# Single status check
status = await client.training.get_status(job.job_id)
print(f"Status: {status.status}, Progress: {status.progress.percent_complete}%")

# Wait for completion with progress callback
def on_progress(status):
    print(f"{status.progress.percent_complete:.0f}%")

final = await client.training.wait_for_completion(
    job.job_id,
    poll_interval=5.0,
    on_progress=on_progress,
)
```

### 5. List Training Jobs
```python
jobs = await client.training.list_jobs(limit=10)
```

### 6. Cancel Training
```python
cancelled = await client.training.cancel(job.job_id, reason="User requested")
```

### 7. Forward Kinematics
```python
fk = await client.kinematics.forward_kinematics(
    urdf=urdf_xml_string,
    joint_values={"joint1": 0.5, "joint2": -0.3},
)
for link in fk.links:
    print(f"{link.name}: {link.position}")
```

### 8. Inverse Kinematics
```python
ik = await client.kinematics.inverse_kinematics(
    urdf=urdf_xml_string,
    joint_values=initial_joints,
    target_link="end_effector",
    target_position=[0.5, 0.2, 0.3],
)
if ik.converged:
    print(f"Solution: {ik.solution.joint_values}")
```

### 9. Get Robot Samples
```python
samples = await client.samples.list()
sample = await client.samples.get("so-arm100")
urdf = sample.get_urdf()
```

### 10. Evaluate Policy
```python
result = await client.training.evaluate(
    checkpoint_path="./outputs/checkpoint.pt",
    num_episodes=5,
)
for ep in result.episodes:
    print(f"Episode {ep.episode_index}: {ep.num_steps} steps")
```

## Model Architectures

| Name | Best For |
|------|----------|
| `act` | Manipulation, bimanual tasks |
| `diffusion_policy` | Diverse demonstrations, multimodal behavior |
| `tdmpc` | Long-horizon tasks, model-based control |
| `vq_bet` | Discrete actions, behavior cloning |

## Compute Backends

| Backend | Description |
|---------|-------------|
| `local` | Local GPU/CPU (free) |
| `modal` | Modal serverless GPU |
| `runpod` | RunPod cloud GPU |

## Error Handling

```python
from backend.sdk.client import SDKError, APIError, ConnectionError, TimeoutError

try:
    status = await client.training.get_status("invalid_id")
except APIError as e:
    print(f"API error: {e}")
except ConnectionError as e:
    print(f"Cannot connect: {e}")
```

## Status Values

```python
from backend.sdk.models import JobStatus

status.status == JobStatus.RUNNING
status.is_running      # True if running
status.is_complete     # True if completed
status.is_failed       # True if failed
status.is_terminal     # True if complete/failed/cancelled
```
