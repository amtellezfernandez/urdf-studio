# UI Implementation Checklist

> Maps frontend work to backend PRs from v0.1 spec

---

## Phase 1: Infrastructure (Before Backend PRs)

These can be done immediately, no backend changes needed:

### PR-UI-0: Mode Switcher & Routing

- [ ] Create `web/src/shared/components/ModeSwitcher.tsx`
- [ ] Create `web/src/app/routes.tsx` (centralized routing)
- [ ] Add `/robotops` and `/studio` routes
- [ ] Add mode persistence in localStorage
- [ ] Update `App.tsx` to use new routing
- [ ] Add redirect: `/` → `/robotops`

**Files:**
```
web/src/
├── shared/components/ModeSwitcher.tsx
├── app/routes.tsx
└── app/App.tsx (modify)
```

### PR-UI-1: RobotOps Shell & Navigation

- [ ] Create `web/src/app/pages/RobotOpsPage.tsx` (layout shell)
- [ ] Create `web/src/features/robotops/RobotOpsNav.tsx` (left nav)
- [ ] Create `web/src/features/robotops/Dashboard.tsx` (skeleton)
- [ ] Add empty states for all sections

**Files:**
```
web/src/
├── app/pages/RobotOpsPage.tsx
└── features/robotops/
    ├── Dashboard.tsx
    ├── RobotOpsNav.tsx
    └── components/
        └── EmptyDashboard.tsx
```

### PR-UI-2: Shared UI Components

- [ ] Create `StatusBadge` component
- [ ] Create `MetricCard` component
- [ ] Create `Stepper` component (for wizard)
- [ ] Create `EmptyState` component
- [ ] Create `DataTable` component (sortable)

**Files:**
```
web/src/shared/ui/
├── status-badge.tsx
├── metric-card.tsx
├── stepper.tsx
├── empty-state.tsx
└── data-table.tsx
```

### PR-UI-3: Settings/Integrations Page

- [ ] Create `web/src/features/settings/SettingsPage.tsx`
- [ ] Create `web/src/features/settings/Integrations.tsx`
- [ ] Move token warnings from FolderUploadScreen
- [ ] Add HF/GitHub/W&B/MLflow status cards
- [ ] Add token configuration dialogs

**Files:**
```
web/src/features/settings/
├── SettingsPage.tsx
└── Integrations.tsx
```

---

## Phase 2: Core Pages (Requires Backend PRs)

### PR-UI-4: Experiment List & Detail

**Requires:** Backend PR2 (Experiments CRUD)

- [ ] Create `web/src/features/experiments/ExperimentList.tsx`
- [ ] Create `web/src/features/experiments/ExperimentDetail.tsx`
- [ ] Create `web/src/features/experiments/useExperimentStore.ts`
- [ ] Create `web/src/features/experiments/useExperimentApi.ts` (React Query hooks)
- [ ] Add experiment cards with run counts
- [ ] Add runs tab on detail page

**Files:**
```
web/src/features/experiments/
├── ExperimentList.tsx
├── ExperimentDetail.tsx
├── useExperimentStore.ts
├── useExperimentApi.ts
└── components/
    ├── ExperimentCard.tsx
    └── ExperimentHeader.tsx
```

### PR-UI-5: Create Experiment Wizard

**Requires:** Backend PR2, PR6 (Experiments + Policy Discovery)

- [ ] Create wizard container `CreateExperimentWizard.tsx`
- [ ] Step 1: Robot selection `StepRobot.tsx`
- [ ] Step 2: Dataset selection `StepDataset.tsx`
- [ ] Step 3: Policy selection `StepPolicy.tsx`
- [ ] Step 4: Compute & training `StepCompute.tsx`
- [ ] Step 5: Review & launch `StepReview.tsx`
- [ ] Wizard state management
- [ ] Form validation per step

**Files:**
```
web/src/features/experiments/CreateWizard/
├── CreateExperimentWizard.tsx
├── StepRobot.tsx
├── StepDataset.tsx
├── StepPolicy.tsx
├── StepCompute.tsx
├── StepReview.tsx
├── useWizardStore.ts
└── validation.ts
```

### PR-UI-6: Run Detail Page

**Requires:** Backend PR3 (Runs Refactor), PR4 (Artifacts)

- [ ] Create `web/src/features/runs/RunDetail.tsx`
- [ ] Create `web/src/features/runs/components/LossCurve.tsx` (Recharts)
- [ ] Create `web/src/features/runs/components/CheckpointList.tsx`
- [ ] Add metrics tab with charts
- [ ] Add checkpoints tab with eval/export actions
- [ ] Add logs tab (polling or SSE)
- [ ] Add "View in MLflow/W&B" button

**Files:**
```
web/src/features/runs/
├── RunDetail.tsx
├── useRunApi.ts
└── components/
    ├── LossCurve.tsx
    ├── CheckpointList.tsx
    ├── RunHeader.tsx
    └── LogViewer.tsx
```

### PR-UI-7: Evaluation Pages

**Requires:** Backend PR5 (Evaluations Persistence)

- [ ] Create `web/src/features/evaluations/EvaluationList.tsx`
- [ ] Create `web/src/features/evaluations/EvaluationDetail.tsx`
- [ ] Create `web/src/features/evaluations/EpisodeList.tsx`
- [ ] Add summary tab with metric cards
- [ ] Add episodes tab with per-episode metrics
- [ ] Add artifacts tab

**Files:**
```
web/src/features/evaluations/
├── EvaluationList.tsx
├── EvaluationDetail.tsx
├── EpisodeList.tsx
├── useEvaluationApi.ts
└── components/
    ├── EvalSummary.tsx
    └── EpisodeRow.tsx
```

### PR-UI-8: Video Player

**Requires:** Backend PR7 (Video Playback)

- [ ] Create `web/src/features/evaluations/VideoPlayer.tsx`
- [ ] Add play/pause/seek controls
- [ ] Add speed control (0.5x, 1x, 2x)
- [ ] Add episode selector dropdown
- [ ] Handle loading/error states

**Files:**
```
web/src/features/evaluations/
└── VideoPlayer.tsx
```

### PR-UI-9: HF Export Flow

**Requires:** Backend PR9 (HF Model Export)

- [ ] Create export dialog `ExportToHFDialog.tsx`
- [ ] Add repo name input
- [ ] Add visibility toggle (public/private)
- [ ] Show model card preview
- [ ] Handle export progress/success/error

**Files:**
```
web/src/features/runs/components/
└── ExportToHFDialog.tsx
```

### PR-UI-10: Dashboard Data Integration

**Requires:** All backend PRs complete

- [ ] Wire up `ActiveJobsCard` with real data
- [ ] Wire up `BestResultCard` with real data
- [ ] Wire up `RecentExperiments` with real data
- [ ] Wire up `SystemStatus` with health checks
- [ ] Add auto-refresh (polling)

**Files:**
```
web/src/features/robotops/
└── Dashboard.tsx (update with real APIs)
```

---

## Phase 3: Polish

### PR-UI-11: Command Palette

- [ ] Create `web/src/shared/ui/command-palette.tsx`
- [ ] Add Cmd+K keyboard shortcut
- [ ] Add actions: New Experiment, Go to Run, Export, etc.
- [ ] Add recent items
- [ ] Add search

### PR-UI-12: Studio Mode Refinement

- [ ] Simplify `FolderUploadScreen.tsx`
- [ ] Remove RobotOps promo card (now in separate mode)
- [ ] Add "Switch to RobotOps" hint
- [ ] Clean up token warnings (now in settings)

### PR-UI-13: Responsive & Polish

- [ ] Mobile responsive nav
- [ ] Loading skeletons
- [ ] Error boundaries
- [ ] Toasts for all actions
- [ ] Keyboard shortcuts help modal

---

## Dependency Graph

```
PR-UI-0 (Routing) ──────────────────────────────────────────────────┐
     │                                                              │
     ▼                                                              │
PR-UI-1 (Shell) ──► PR-UI-4 (Experiments) ──► PR-UI-5 (Wizard)     │
     │                    │                        │                │
     │                    ▼                        │                │
     │              PR-UI-6 (Runs) ────────────────┤                │
     │                    │                        │                │
     │                    ▼                        ▼                │
     │              PR-UI-7 (Evaluations) ──► PR-UI-8 (Video)      │
     │                    │                                        │
     │                    ▼                                        │
     │              PR-UI-9 (HF Export)                            │
     │                                                              │
     ▼                                                              ▼
PR-UI-2 (Components) ◄──────────────────────────────────────────────┘
     │
     ▼
PR-UI-3 (Settings)

PR-UI-10 (Dashboard Data) ← requires all above
PR-UI-11 (Command Palette) ← independent
PR-UI-12 (Studio Polish) ← independent
PR-UI-13 (Responsive) ← after all features
```

---

## Sprint Mapping

### Sprint 1 (Week 1)
- [x] UI Spec complete
- [ ] PR-UI-0: Mode Switcher & Routing
- [ ] PR-UI-1: RobotOps Shell
- [ ] PR-UI-2: Shared Components
- [ ] PR-UI-3: Settings Page

### Sprint 2 (Week 2-3)
*Parallel with Backend PR2-PR4*
- [ ] PR-UI-4: Experiment List & Detail
- [ ] PR-UI-5: Create Experiment Wizard
- [ ] PR-UI-6: Run Detail Page

### Sprint 3 (Week 4-5)
*Parallel with Backend PR5-PR7*
- [ ] PR-UI-7: Evaluation Pages
- [ ] PR-UI-8: Video Player
- [ ] PR-UI-9: HF Export Flow

### Sprint 4 (Week 6)
- [ ] PR-UI-10: Dashboard Integration
- [ ] PR-UI-11: Command Palette
- [ ] PR-UI-12: Studio Polish
- [ ] PR-UI-13: Responsive & Polish

---

## API Hooks Pattern

All API interactions use React Query:

```typescript
// web/src/features/experiments/useExperimentApi.ts

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/client";

// List experiments
export function useExperiments() {
  return useQuery({
    queryKey: ["experiments"],
    queryFn: () => api.get("/api/experiments").then(r => r.data),
  });
}

// Get single experiment
export function useExperiment(id: string) {
  return useQuery({
    queryKey: ["experiments", id],
    queryFn: () => api.get(`/api/experiments/${id}`).then(r => r.data),
    enabled: !!id,
  });
}

// Create experiment
export function useCreateExperiment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExperimentInput) =>
      api.post("/api/experiments", data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
    },
  });
}
```

---

## State Management Pattern

Zustand for UI state, React Query for server state:

```typescript
// web/src/features/experiments/useExperimentStore.ts

import { create } from "zustand";

interface ExperimentUIState {
  // UI state only (not server data)
  selectedTab: "runs" | "evaluations" | "artifacts";
  setSelectedTab: (tab: "runs" | "evaluations" | "artifacts") => void;

  // Wizard state
  wizardStep: number;
  setWizardStep: (step: number) => void;
  wizardData: Partial<CreateExperimentInput>;
  setWizardData: (data: Partial<CreateExperimentInput>) => void;
  resetWizard: () => void;
}

export const useExperimentStore = create<ExperimentUIState>((set) => ({
  selectedTab: "runs",
  setSelectedTab: (tab) => set({ selectedTab: tab }),

  wizardStep: 0,
  setWizardStep: (step) => set({ wizardStep: step }),
  wizardData: {},
  setWizardData: (data) => set((s) => ({ wizardData: { ...s.wizardData, ...data } })),
  resetWizard: () => set({ wizardStep: 0, wizardData: {} }),
}));
```
