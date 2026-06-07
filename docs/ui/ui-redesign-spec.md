# UI Redesign Specification

> **Version:** v0.1
> **Status:** Draft
> **Last Updated:** 2026-01-26

---

## Executive Summary

Transform the product from "URDF viewer with training" to "RobotMLOps platform with URDF studio".

| Before | After |
|--------|-------|
| Homepage = Load URDF | Homepage = RobotOps Dashboard |
| Training hidden in dialogs | Experiments as first-class |
| Token errors on landing | Integrations in settings |
| Single mode | Dual mode: Studio / RobotOps |

---

## 1. Information Architecture

### 1.1 Route Structure

```
/                           → Redirect to /robotops (new default)
/robotops                   → RobotOps Dashboard
/robotops/experiments       → Experiment List
/robotops/experiments/:id   → Experiment Detail (runs, evals)
/robotops/runs/:id          → Run Detail (checkpoints, metrics, logs)
/robotops/evaluations/:id   → Evaluation Detail (episodes, video)
/robotops/models            → HF Exports / Model Registry Lite
/robotops/datasets          → Dataset Browser + Pinned
/robotops/settings          → Integrations, Tokens, Storage

/studio                     → Studio Landing (simplified URDF loader)
/studio/viewer              → Current 3D Viewer + Editor
/studio/recorder            → Motion Recorder
/studio/exporter            → Dataset Exporter
/studio/settings            → Render, Performance
```

### 1.2 Navigation Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Logo] URDF Studio    [Studio ▼ | RobotOps ▼]         [⌘K] [⚙️]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌─────────────────────────────────────────────┐ │
│  │ Left Nav     │  │                                             │ │
│  │              │  │              Main Content                   │ │
│  │ Dashboard    │  │                                             │ │
│  │ Experiments  │  │                                             │ │
│  │ Runs         │  │                                             │ │
│  │ Evaluations  │  │                                             │ │
│  │ Models       │  │                                             │ │
│  │ Datasets     │  │                                             │ │
│  │ ─────────    │  │                                             │ │
│  │ Settings     │  │                                             │ │
│  └──────────────┘  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Mode Switcher Component

### 2.1 Design

```
┌─────────────────────────────────┐
│  ┌─────────┬───────────┐        │
│  │ Studio  │ RobotOps  │ ← Active tab highlighted
│  └─────────┴───────────┘        │
└─────────────────────────────────┘
```

### 2.2 Behavior

- Persists in localStorage: `urdf-studio-mode: "studio" | "robotops"`
- First-time users see RobotOps (default)
- URL-driven: visiting `/studio/*` sets mode to Studio
- Keyboard shortcut: `Cmd+1` (Studio), `Cmd+2` (RobotOps)

### 2.3 Implementation

```tsx
// web/src/shared/components/ModeSwitcher.tsx
interface ModeSwitcherProps {
  mode: "studio" | "robotops";
  onModeChange: (mode: "studio" | "robotops") => void;
}

export function ModeSwitcher({ mode, onModeChange }: ModeSwitcherProps) {
  return (
    <div className="flex rounded-lg bg-muted p-1">
      <button
        className={cn(
          "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
          mode === "studio" ? "bg-background shadow-sm" : "text-muted-foreground"
        )}
        onClick={() => onModeChange("studio")}
      >
        Studio
      </button>
      <button
        className={cn(
          "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
          mode === "robotops" ? "bg-background shadow-sm" : "text-muted-foreground"
        )}
        onClick={() => onModeChange("robotops")}
      >
        RobotOps
      </button>
    </div>
  );
}
```

---

## 3. RobotOps Dashboard

### 3.1 Layout (Above the Fold)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  RobotOps Dashboard                                    [+ New Experiment]│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        PRIMARY ACTIONS                              ││
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ││
│  │  │  📊               │  │  🎯               │  │  🚀               │  ││
│  │  │  New Experiment   │  │  Evaluate Model   │  │  Export to HF     │  ││
│  │  │  Create training  │  │  Run checkpoint   │  │  Push best model  │  ││
│  │  │  experiment       │  │  in simulation    │  │  to HuggingFace   │  ││
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌────────────────────────────────┐  ┌────────────────────────────────┐│
│  │  ACTIVE JOBS (2)               │  │  BEST RECENT RESULT            ││
│  │                                │  │                                ││
│  │  ┌───────────────────────────┐ │  │  ┌───────────────────────────┐ ││
│  │  │ 🟢 Training               │ │  │  │  pusht-act-v3             │ ││
│  │  │ pusht-act-baseline        │ │  │  │  ────────────────────     │ ││
│  │  │ Epoch 45/100 • 45%        │ │  │  │  Success Rate: 92%        │ ││
│  │  │ [Logs] [W&B] [Cancel]     │ │  │  │  Avg Return: 185.3        │ ││
│  │  └───────────────────────────┘ │  │  │  ────────────────────     │ ││
│  │  ┌───────────────────────────┐ │  │  │  [View] [Export to HF]    │ ││
│  │  │ 🟡 Evaluating             │ │  │  └───────────────────────────┘ ││
│  │  │ libero-diffusion-v2       │ │  │                                ││
│  │  │ Episode 7/10              │ │  │                                ││
│  │  │ [Logs] [View]             │ │  │                                ││
│  │  └───────────────────────────┘ │  │                                ││
│  └────────────────────────────────┘  └────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Layout (Below the Fold)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  RECENT EXPERIMENTS                                    [View All →] ││
│  │  ───────────────────────────────────────────────────────────────── ││
│  │  Name                    Dataset              Runs  Status    Date ││
│  │  pusht-act-baseline      lerobot/pusht@a3f2   5     ✓ 3 done  2h   ││
│  │  libero-diffusion        lerobot/libero@b4e1  2     🔄 running 5h   ││
│  │  aloha-vqbet             lerobot/aloha@c5d0   8     ✓ all done 1d  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  LATEST EVALUATIONS                                    [View All →] ││
│  │  ───────────────────────────────────────────────────────────────── ││
│  │  Experiment              Checkpoint       Success  Return   Video  ││
│  │  pusht-act-baseline      epoch_100        92%      185.3    [▶]    ││
│  │  libero-diffusion        final_model      78%      142.1    [▶]    ││
│  │  aloha-vqbet             epoch_50         85%      163.7    [▶]    ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  SYSTEM STATUS                                                      ││
│  │  ───────────────────────────────────────────────────────────────── ││
│  │  ✓ Backend connected (localhost:8000)                              ││
│  │  ✓ HuggingFace token configured                                    ││
│  │  ⚠ W&B token not configured          [Configure →]                 ││
│  │  ✓ Artifact storage OK (local: ./outputs)                          ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Component Breakdown

| Component | File | Props |
|-----------|------|-------|
| `DashboardPage` | `pages/RobotOpsDashboard.tsx` | - |
| `PrimaryActions` | `components/PrimaryActions.tsx` | `onAction: (action) => void` |
| `ActiveJobsCard` | `components/ActiveJobsCard.tsx` | `jobs: Job[]` |
| `BestResultCard` | `components/BestResultCard.tsx` | `result: EvalResult` |
| `RecentExperiments` | `components/RecentExperiments.tsx` | `experiments: Experiment[]` |
| `LatestEvaluations` | `components/LatestEvaluations.tsx` | `evaluations: Evaluation[]` |
| `SystemStatus` | `components/SystemStatus.tsx` | `status: SystemStatus` |

---

## 4. Create Experiment Wizard

### 4.1 Flow Overview

```
Step 1: Robot → Step 2: Dataset → Step 3: Policy → Step 4: Compute → Step 5: Review
```

### 4.2 Step 1: Robot Selection

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Create Experiment                                          Step 1 of 5 │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  Select Robot                                                           │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │  📁               │  │  🔗               │  │  ⏱️               │      │
│  │  Load from Folder │  │  Load from Repo  │  │  Recent Robots   │      │
│  │  Browse local     │  │  GitHub/HF       │  │  Quick select    │      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  RECENT ROBOTS                                                      ││
│  │                                                                     ││
│  │  ○ SO-ARM100           /home/user/robots/so-arm100/urdf/...        ││
│  │  ○ ALOHA               lerobot/aloha-urdf                          ││
│  │  ● Koch v1.1           /home/user/robots/koch/...          [Selected]│
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  PREVIEW                                                            ││
│  │  ┌─────────────────────────────────┐  URDF: koch_v1.1.urdf         ││
│  │  │                                 │  Joints: 6 (revolute)         ││
│  │  │      [3D Robot Preview]         │  Links: 7                     ││
│  │  │                                 │  Hash: abc123...              ││
│  │  │                                 │                               ││
│  │  └─────────────────────────────────┘                               ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                              [Cancel]  [Back]  [Next →] │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Step 2: Dataset Selection

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Create Experiment                                          Step 2 of 5 │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  Select Dataset                                                         │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  🔍 Search HuggingFace datasets...                    [🔄 Refresh] ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  POPULAR LEROBOT DATASETS                                          ││
│  │                                                                     ││
│  │  ● lerobot/pusht              Push-T manipulation    50k episodes  ││
│  │  ○ lerobot/aloha_sim_insertion ALOHA bimanual       10k episodes  ││
│  │  ○ lerobot/xarm_lift_medium   xArm lifting          25k episodes  ││
│  │  ○ lerobot/libero_spatial     Libero spatial        30k episodes  ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  SELECTED: lerobot/pusht                                           ││
│  │  ─────────────────────────────────────────────────────────────     ││
│  │                                                                     ││
│  │  Version:  [main ▼]                                                ││
│  │                                                                     ││
│  │  📌 Resolved Commit: a3f2c8d (2026-01-15)                          ││
│  │     This version will be pinned for reproducibility.               ││
│  │                                                                     ││
│  │  Episodes: 50,000  │  FPS: 10  │  Robot: pusht_sim                 ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                            [Cancel]  [← Back]  [Next →] │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Step 3: Policy Selection

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Create Experiment                                          Step 3 of 5 │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  Select Policy Architecture                                             │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  ┌───────────────────┐  ┌───────────────────┐                      ││
│  │  │ ● ACT             │  │ ○ Diffusion       │                      ││
│  │  │   Action Chunking │  │   Diffusion       │                      ││
│  │  │   Transformer     │  │   Policy          │                      ││
│  │  │   ✓ Recommended   │  │                   │                      ││
│  │  └───────────────────┘  └───────────────────┘                      ││
│  │  ┌───────────────────┐  ┌───────────────────┐                      ││
│  │  │ ○ TD-MPC          │  │ ○ VQ-BeT          │                      ││
│  │  │   Temporal Diff   │  │   Vector Quantized│                      ││
│  │  │   Model Pred Ctrl │  │   Behavior Trans  │                      ││
│  │  └───────────────────┘  └───────────────────┘                      ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  ACT CONFIGURATION                                                  ││
│  │  ─────────────────────────────────────────────────────────────     ││
│  │                                                                     ││
│  │  Chunk Size        [100        ]  Prediction horizon               ││
│  │  Hidden Dim        [256        ]  Transformer hidden dimension     ││
│  │  Num Heads         [8          ]  Attention heads                  ││
│  │  Num Layers        [4          ]  Transformer layers               ││
│  │                                                                     ││
│  │  [↻ Reset to Defaults]                                             ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                            [Cancel]  [← Back]  [Next →] │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Step 4: Compute & Training

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Create Experiment                                          Step 4 of 5 │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  Configure Training                                                     │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  COMPUTE BACKEND                                                        │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐   │
│  │ ● Local GPU       │  │ ○ Modal           │  │ ○ RunPod          │   │
│  │   RTX 4090        │  │   Serverless      │  │   On-demand       │   │
│  │   Free            │  │   ~$0.80/hr       │  │   ~$0.50/hr       │   │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘   │
│                                                                         │
│  TRAINING PARAMETERS                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Batch Size        [32         ]     Epochs           [100       ] ││
│  │  Learning Rate     [1e-4       ]     Seed             [42        ] ││
│  │  LR Scheduler      [cosine ▼   ]     Warmup Steps     [500       ] ││
│  │  Weight Decay      [0.01       ]     Grad Accum Steps [1         ] ││
│  │                                                                     ││
│  │  ─────────────────────────────────────────────────────────────     ││
│  │                                                                     ││
│  │  Checkpoint Interval  [10        ]  Save every N epochs            ││
│  │  Keep Last N          [3         ]  Checkpoints to retain          ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  EXPERIMENT TRACKING                                                    │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐   │
│  │ ○ None            │  │ ● MLflow          │  │ ○ W&B             │   │
│  │                   │  │   Local server    │  │   ⚠ Not configured│   │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘   │
│                                                                         │
│                                            [Cancel]  [← Back]  [Next →] │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Step 5: Review & Launch

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Create Experiment                                          Step 5 of 5 │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  Review & Launch                                                        │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  EXPERIMENT NAME                                                    ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │ pusht-act-baseline                                          │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  DESCRIPTION (optional)                                            ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │ Baseline ACT policy on PushT dataset                        │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  CONFIGURATION SUMMARY                                             ││
│  │  ─────────────────────────────────────────────────────────────     ││
│  │                                                                     ││
│  │  Robot         Koch v1.1                    hash: abc123...        ││
│  │  Dataset       lerobot/pusht                @ a3f2c8d              ││
│  │  Policy        ACT                          chunk=100, hidden=256  ││
│  │  Compute       Local GPU (RTX 4090)         Free                   ││
│  │  Training      100 epochs, batch=32         lr=1e-4, cosine        ││
│  │  Tracking      MLflow                       localhost:5000         ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  ⓘ This will create an experiment and start the first training    ││
│  │    run immediately. You can add more runs later.                   ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                    [Cancel]  [← Back]  [🚀 Launch]      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Experiment Detail Page

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ← Experiments    pusht-act-baseline                    [+ New Run]     │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  ┌────────────────────────────────────────────────┐ ┌─────────────────┐│
│  │  EXPERIMENT INFO                               │ │  QUICK STATS    ││
│  │  ──────────────────────────────────────────   │ │  ───────────── ││
│  │  Dataset: lerobot/pusht @ a3f2c8d             │ │  Runs: 5        ││
│  │  Robot: Koch v1.1                             │ │  Completed: 3   ││
│  │  Created: Jan 26, 2026                        │ │  Best: 92%      ││
│  │  [Edit] [Delete]                              │ │                 ││
│  └────────────────────────────────────────────────┘ └─────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  [Runs]  [Evaluations]  [Checkpoints]  [Artifacts]                 ││
│  ├─────────────────────────────────────────────────────────────────────┤│
│  │                                                                     ││
│  │  RUNS                                                               ││
│  │  ─────────────────────────────────────────────────────────────     ││
│  │  Run ID      Policy    Status      Loss    Created     Actions     ││
│  │  run-001     ACT       ✓ Done      0.05    2h ago      [View]      ││
│  │  run-002     ACT       ✓ Done      0.04    5h ago      [View]      ││
│  │  run-003     Diffusion 🔄 Running  0.12    10m ago     [View][Stop]││
│  │  run-004     ACT       ✗ Failed    -       1d ago      [View][Retry]│
│  │  run-005     VQ-BeT    ⏸ Queued    -       just now    [View][Cancel]│
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Run Detail Page

### 6.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ← pusht-act-baseline    run-001                      [Evaluate] [Export]│
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  STATUS: ✓ Completed                           Duration: 2h 34m    ││
│  │  ───────────────────────────────────────────────────────────────── ││
│  │  Policy: ACT (chunk=100, hidden=256)                               ││
│  │  Final Loss: 0.0523    │    LR: 1e-4    │    Epochs: 100/100      ││
│  │                                                                     ││
│  │  [View in MLflow]  [View Logs]  [Download Config]                  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  [Metrics]  [Checkpoints]  [Evaluations]  [Logs]                   ││
│  ├─────────────────────────────────────────────────────────────────────┤│
│  │                                                                     ││
│  │  LOSS CURVE                                                        ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │     0.5 ┤                                                   │   ││
│  │  │         │╲                                                  │   ││
│  │  │     0.3 ┤ ╲                                                 │   ││
│  │  │         │  ╲__                                              │   ││
│  │  │     0.1 ┤     ╲___________                                  │   ││
│  │  │         │                 ‾‾‾‾‾‾‾‾‾‾‾‾                      │   ││
│  │  │     0.0 ┼──────────────────────────────────────────────────│   ││
│  │  │         0        25        50        75       100  epochs   │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  CHECKPOINTS                                                       ││
│  │  ─────────────────────────────────────────────────────────────     ││
│  │  Name              Epoch    Loss     Evaluated    Actions          ││
│  │  final_model       100      0.052    ✓ 92%        [Eval] [Export]  ││
│  │  checkpoint_90     90       0.055    -            [Eval] [Export]  ││
│  │  checkpoint_80     80       0.061    ✓ 88%        [Eval] [Export]  ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Evaluation Detail Page

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ← run-001    eval-001                                  [Re-run] [Export]│
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  EVALUATION SUMMARY                                                 ││
│  │  ───────────────────────────────────────────────────────────────── ││
│  │                                                                     ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐││
│  │  │  SUCCESS     │  │  AVG RETURN  │  │  AVG LENGTH  │  │ EPISODES │││
│  │  │    92%       │  │    185.3     │  │    195       │  │   10     │││
│  │  │  (9/10)      │  │   ±12.4      │  │   ±15        │  │          │││
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘││
│  │                                                                     ││
│  │  Checkpoint: final_model  │  Dataset: lerobot/pusht @ a3f2c8d     ││
│  │  Seed: 42                 │  Completed: Jan 26, 2026 at 14:32     ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  [Summary]  [Episodes]  [Video]  [Artifacts]                       ││
│  ├─────────────────────────────────────────────────────────────────────┤│
│  │                                                                     ││
│  │  EPISODES                                                           ││
│  │  ─────────────────────────────────────────────────────────────     ││
│  │  #    Success    Return    Length    Video                         ││
│  │  1    ✓          192.3     187       [▶ Play]                      ││
│  │  2    ✓          178.1     203       [▶ Play]                      ││
│  │  3    ✗          85.2      250       [▶ Play]                      ││
│  │  4    ✓          195.0     182       [▶ Play]                      ││
│  │  ...                                                               ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Video Tab

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [Summary]  [Episodes]  [Video]  [Artifacts]                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │                                                                     ││
│  │                      ┌─────────────────────┐                        ││
│  │                      │                     │                        ││
│  │                      │   [Video Player]    │                        ││
│  │                      │                     │                        ││
│  │                      │                     │                        ││
│  │                      └─────────────────────┘                        ││
│  │                                                                     ││
│  │                      [|◀] [▶||] [▶|]  ══════════●═══  1:23 / 2:45  ││
│  │                                                                     ││
│  │                      Speed: [1x ▼]    Episode: [#1 ▼]              ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Settings / Integrations Page

### 8.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Settings                                                               │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  INTEGRATIONS                                                       ││
│  │  ───────────────────────────────────────────────────────────────── ││
│  │                                                                     ││
│  │  HuggingFace                                                       ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │  ✓ Token configured                              [Update]   │   ││
│  │  │    Logged in as: charbel                                    │   ││
│  │  │    Permissions: Read + Write                                │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  GitHub                                                            ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │  ✓ Token configured                              [Update]   │   ││
│  │  │    Logged in as: charbel                                    │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  Weights & Biases                                                  ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │  ⚠ Not configured                               [Configure] │   ││
│  │  │    Add your W&B API key to enable experiment tracking       │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  MLflow                                                            ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │  ✓ Server running                                [Test]     │   ││
│  │  │    URL: http://localhost:5000                               │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  STORAGE                                                           ││
│  │  ───────────────────────────────────────────────────────────────── ││
│  │                                                                     ││
│  │  Artifact Storage                                                  ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │  Backend: Local Filesystem                                  │   ││
│  │  │  Path: ./outputs                                            │   ││
│  │  │  Used: 2.3 GB                                               │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Studio Mode (Simplified)

### 9.1 Landing Page

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  URDF Studio                                                            │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │  📁               │  │  🔗               │  │  ⏱️               │      │
│  │  Open Folder      │  │  Open from Repo  │  │  Recent Robots   │      │
│  │  Browse local     │  │  GitHub/HF       │  │  Quick access    │      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  RECENT ROBOTS                                                      ││
│  │                                                                     ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐││
│  │  │ [Preview]   │  │ [Preview]   │  │ [Preview]   │  │ [Preview]   │││
│  │  │ SO-ARM100   │  │ Koch v1.1   │  │ ALOHA       │  │ xArm        │││
│  │  │ 2h ago      │  │ Yesterday   │  │ 3 days ago  │  │ 1 week ago  │││
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  💡 Looking for training & evaluation?                                  │
│     Switch to RobotOps mode to create experiments and train policies.  │
│     [Switch to RobotOps →]                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Component Library Extensions

### 10.1 New Shared Components Needed

| Component | Description | Location |
|-----------|-------------|----------|
| `StatusBadge` | Consistent status indicators | `shared/ui/status-badge.tsx` |
| `MetricCard` | Display single metric with label | `shared/ui/metric-card.tsx` |
| `DataTable` | Sortable, filterable table | `shared/ui/data-table.tsx` |
| `Stepper` | Wizard step indicator | `shared/ui/stepper.tsx` |
| `EmptyState` | Consistent empty state | `shared/ui/empty-state.tsx` |
| `CommandPalette` | Cmd+K search | `shared/ui/command-palette.tsx` |

### 10.2 StatusBadge Variants

```tsx
<StatusBadge status="running" />    // 🟢 with pulse animation
<StatusBadge status="completed" />  // ✓ green
<StatusBadge status="failed" />     // ✗ red
<StatusBadge status="queued" />     // ⏸ yellow
<StatusBadge status="cancelled" />  // ⊘ gray
```

### 10.3 MetricCard

```tsx
<MetricCard
  label="Success Rate"
  value="92%"
  subtext="9/10 episodes"
  trend="+5%"  // optional
/>
```

---

## 11. Implementation Phases

### Phase 1: Fast Wins (Week 1)

| Task | Files | Effort |
|------|-------|--------|
| Add ModeSwitcher component | `shared/components/ModeSwitcher.tsx` | 2h |
| Add `/robotops` route (skeleton) | `pages/RobotOpsPage.tsx` | 2h |
| Move token warnings to settings | Refactor `FolderUploadScreen.tsx` | 3h |
| Create RobotOps left nav | `features/robotops/RobotOpsNav.tsx` | 3h |
| Dashboard skeleton with empty states | `features/robotops/Dashboard.tsx` | 4h |

### Phase 2: Core Flow (Week 2-3)

| Task | Files | Effort |
|------|-------|--------|
| Create Experiment wizard (5 steps) | `features/experiments/CreateWizard/` | 2d |
| Experiment list page | `features/experiments/ExperimentList.tsx` | 1d |
| Experiment detail page | `features/experiments/ExperimentDetail.tsx` | 1d |
| Run detail page | `features/runs/RunDetail.tsx` | 1d |
| Evaluation detail page | `features/evaluations/EvalDetail.tsx` | 1d |

### Phase 3: Polish (Week 4)

| Task | Files | Effort |
|------|-------|--------|
| Video player component | `features/evaluations/VideoPlayer.tsx` | 1d |
| Settings/Integrations page | `features/settings/Integrations.tsx` | 0.5d |
| Command palette (Cmd+K) | `shared/ui/command-palette.tsx` | 1d |
| Empty states + onboarding | Various | 0.5d |
| Mobile responsive tweaks | Various | 0.5d |

---

## 12. File Structure After Redesign

```
web/src/
├── app/
│   ├── App.tsx
│   ├── routes.tsx                    # NEW: centralized routing
│   └── pages/
│       ├── RobotOpsPage.tsx          # NEW: /robotops layout
│       └── StudioPage.tsx            # NEW: /studio layout
│
├── features/
│   ├── robotops/                     # NEW
│   │   ├── Dashboard.tsx
│   │   ├── RobotOpsNav.tsx
│   │   └── components/
│   │       ├── ActiveJobsCard.tsx
│   │       ├── BestResultCard.tsx
│   │       ├── PrimaryActions.tsx
│   │       ├── RecentExperiments.tsx
│   │       └── SystemStatus.tsx
│   │
│   ├── experiments/                  # NEW
│   │   ├── ExperimentList.tsx
│   │   ├── ExperimentDetail.tsx
│   │   ├── useExperimentStore.ts
│   │   └── CreateWizard/
│   │       ├── CreateExperimentWizard.tsx
│   │       ├── StepRobot.tsx
│   │       ├── StepDataset.tsx
│   │       ├── StepPolicy.tsx
│   │       ├── StepCompute.tsx
│   │       └── StepReview.tsx
│   │
│   ├── runs/                         # NEW
│   │   ├── RunList.tsx
│   │   ├── RunDetail.tsx
│   │   └── components/
│   │       ├── LossCurve.tsx
│   │       └── CheckpointList.tsx
│   │
│   ├── evaluations/                  # NEW
│   │   ├── EvaluationList.tsx
│   │   ├── EvaluationDetail.tsx
│   │   ├── VideoPlayer.tsx
│   │   └── EpisodeList.tsx
│   │
│   ├── settings/                     # NEW
│   │   ├── SettingsPage.tsx
│   │   └── Integrations.tsx
│   │
│   ├── studio/                       # REFACTORED from current
│   │   ├── StudioLanding.tsx         # Simplified landing
│   │   └── ... (existing viewer components)
│   │
│   └── ... (existing features)
│
└── shared/
    ├── components/
    │   └── ModeSwitcher.tsx          # NEW
    └── ui/
        ├── status-badge.tsx          # NEW
        ├── metric-card.tsx           # NEW
        ├── data-table.tsx            # NEW
        ├── stepper.tsx               # NEW
        ├── empty-state.tsx           # NEW
        └── command-palette.tsx       # NEW
```
