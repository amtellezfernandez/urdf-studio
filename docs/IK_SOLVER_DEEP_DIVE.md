# IK Solver Deep Dive (Code Truth)

This document explains exactly how IK works today in `urdf-studio`, with direct references to the current code paths.

Scope:
- Viewer-side IK (object click + drag handle).
- Solver dispatch (local/worker/remote).
- Arm scoping, wheel-drive interaction, trajectory application, safety projection.
- What exists but is not wired yet.

Non-scope:
- Backend solver internals outside this repo.

---

## 1) Mental Model: There are 2 IK pipelines

### Pipeline A: Object-click IK (discrete solve + trajectory apply)
1. User clicks an object in the 3D scene (`CreatedObjects`).
2. `Viewer3D` calls `solveIkForObject`.
3. Solver returns one target joint map (`ikResult`).
4. `Viewer3D` auto-applies that result through `applyIkSolutionWithPath` (trajectory runtime + safety projection + convergence check).

Relevant code:
- `web/src/features/viewer/Viewer3D.tsx:4555`
- `web/src/features/viewer/useIkSolver.ts:461`
- `web/src/features/viewer/Viewer3D.tsx:3797`
- `web/src/features/viewer/Viewer3D.tsx:3383`

### Pipeline B: Drag-handle IK (continuous solve + streaming apply)
1. Handle(s) are rendered, one per EE link.
2. Drag events generate local target tickets.
3. Scheduler keeps latest target and throttles requests.
4. Each solve result is filtered to active arm chain and applied immediately through `handleIkDragSolved` (blending + velocity limits + clamp + kernel).

Relevant code:
- `web/src/features/viewer/Viewer3D.tsx:4534`
- `web/src/features/viewer/IKDragControls.tsx:403`
- `web/src/features/viewer/drag-runtime/scheduler.ts:22`
- `web/src/features/viewer/useIkSolver.ts:984`

---

## 2) Core contracts and state stores

### IK payload/response types
- `IkSolvePayload`, `IkSolveStrategy`, `IkSolveResponse`:
  - `web/src/features/ik/types.ts:32`
  - `web/src/features/ik/types.ts:41`
  - `web/src/features/ik/types.ts:55`

### Runtime params and defaults
- Drag config defaults:
  - `web/src/features/viewer/config.ts:3`
- Timeout defaults:
  - request: 1200ms
  - drag: 300ms
  - orbit: 250ms
  - `web/src/features/viewer/config.ts:23`
- Store for orientation/timeout/solver tuning:
  - `web/src/features/ik/useIkParamsStore.ts:38`

### Selected solver store behavior (important code truth)
- `selectedSolverId` is forced to `ik-js`.
- `setSelectedSolverId` ignores requested solver and keeps `ik-js`.
- `setAvailableSolvers` keeps only local `ik-js`.
- `web/src/features/ik/useIkSolverStore.ts:26`

Practical effect:
- UI may show many solver concepts in codebase, but active frontend selection is hard-locked to local `ik-js` right now.

---

## 3) Solver chain and execution routing

### Solver ids and orientation strategy expansion
- Known solver IDs:
  - `lerobot-placo`, `amik`, `ikfast-wasm`, `ik-js`
  - `web/src/features/ik/registry.ts:7`
- Orientation modes:
  - `required | optional | prefer | ignore | position_first`
  - `web/src/features/ik/registry.ts:71`
- Strategy expansion:
  - `buildIkStrategies` creates `(solverId, ignoreOrientation)` attempts
  - `web/src/features/ik/registry.ts:78`

### solveIk routing logic
- Entry point:
  - `web/src/features/ik/ikClient.ts:209`
- If worker unavailable or chain contains `ik-js`, solve in main thread:
  - `web/src/features/ik/ikClient.ts:230`
- Main thread path:
  - Try local strategies (`ikfast-wasm`, `ik-js`) first.
  - Then backend for remote-only remainder.
  - `web/src/features/ik/ikClient.ts:174`
- Worker path (`ikBroker` + `ikWorker`):
  - Broker concurrency: 2
  - `web/src/features/ik/ikBroker.ts:9`
  - Worker concurrency: 2
  - `web/src/features/ik/ikWorker.ts:25`

### Cancellation behavior
- Drag path cancels in-flight request IDs aggressively:
  - `web/src/features/viewer/IKDragControls.tsx:510`
  - `web/src/features/viewer/IKDragControls.tsx:782`
- `ikClient.cancelIk` forwards to broker:
  - `web/src/features/ik/ikClient.ts:267`

---

## 4) Object-click IK path in detail

Function:
- `solveIkForObject`
- `web/src/features/viewer/useIkSolver.ts:461`

### 4.1 Guards and state prep
- Requires `robot`, `urdfContent`, `endEffectorLink`.
- Stops active orbit-follow if needed.
- Reads latest object from store to avoid stale clicked state.
- `web/src/features/viewer/useIkSolver.ts:468`
- `web/src/features/viewer/useIkSolver.ts:485`

### 4.2 Target construction
- Orbit targets: compute point on orbit arc.
- Point targets: object center.
- `web/src/features/viewer/useIkSolver.ts:516`

### 4.3 Orientation target
- For non-orbit:
  - chooses best approach axis from EE local axes
  - aligns EE axis toward target COM direction
- `resolveApproachAxisForEe`:
  - `web/src/features/viewer/useIkSolver.ts:135`
- `deriveComAlignedQuaternion`:
  - `web/src/features/viewer/useIkSolver.ts:97`

### 4.4 Rear-target transit seed
- If target is "behind" current EE approach direction (`rearTargetDot < -0.12`), do a fast transit solve first.
- Transit solve:
  - small outward radial waypoint + raised height
  - `orientationMode: optional`
  - short timeout cap (`min(requestTimeoutMs, 260)`)
- `web/src/features/viewer/useIkSolver.ts:589`
- `web/src/features/viewer/useIkSolver.ts:619`

### 4.5 Stale solve token
- Every click increments `objectSolveTokenRef`.
- Async steps check token before applying result.
- Prevents late/old solves from overwriting new target.
- `web/src/features/viewer/useIkSolver.ts:590`

### 4.6 Primary solve + fallback gate
- Primary solve uses current selected solver id chain `[selectedSolverId]`.
- If non-orbit and solver is not `ik-js`, and posture risk is high:
  - runs one fallback attempt with `ik-js`
  - accepts fallback only if cost is comparable and posture risk improves enough.
- `web/src/features/viewer/useIkSolver.ts:681`
- `web/src/features/viewer/useIkSolver.ts:714`

### 4.7 Posture risk score
- `scoreSolutionPostureRisk` penalizes:
  - near-limit edge behavior
  - fold tendency (centerNorm^4 term)
  - large displacement from reference seed
- `web/src/features/viewer/useIkSolver.ts:213`

### 4.8 Result handling
- Stores `ikResult`; then `Viewer3D` effect auto-applies path.
- `web/src/features/viewer/useIkSolver.ts:751`
- `web/src/features/viewer/Viewer3D.tsx:3797`

---

## 5) Trajectory application (`applyIkSolutionWithPath`)

Function:
- `web/src/features/viewer/Viewer3D.tsx:3383`

### 5.1 Arm scoping before any interpolation
- If motion kernel exists:
  - sanitize to manipulator owner for selected EE.
- Otherwise fallback filter using `ikAllowedJointNamesByEe`.
- `web/src/features/viewer/Viewer3D.tsx:3391`
- `web/src/features/viewer/Viewer3D.tsx:3397`

### 5.2 Joint specs for runtime
- For each targeted joint:
  - start, target, max velocity, max acceleration.
- `velocityFloorRadPerSec = 2.6`
- `maxAcceleration = maxVelocity * 6` min 0.8.
- `web/src/features/viewer/Viewer3D.tsx:3435`

### 5.3 AdaptiveTrajectoryRuntime
- Created per apply with context key:
  - robot id + sorted joint list.
- Persists profile in localStorage.
- `web/src/features/viewer/Viewer3D.tsx:3498`
- `web/src/features/ik/runtime/adaptiveTrajectoryRuntime.ts:51`

Runtime internals:
- Easing over normalized `t` with power curve.
- Velocity state per joint.
- Acceleration-bounded velocity update.
- Per-frame unresolved joint count.
- `web/src/features/ik/runtime/adaptiveTrajectoryRuntime.ts:148`

Adaptive profile updates:
- If too many safety projections -> reduce speed/accel scales.
- If rapid+clean -> increase scales slightly.
- `web/src/features/ik/runtime/adaptiveTrajectoryRuntime.ts:257`

### 5.4 Safety projection during trajectory
- For each frame:
  - evaluate candidate frame safety (`floorMinZ`, min pair distance on chain points).
  - if unsafe, binary-search projection between current and proposed.
- `web/src/features/viewer/Viewer3D.tsx:3554`
- `web/src/features/viewer/Viewer3D.tsx:3636`

### 5.5 Base pose constraints
- Non-assembly:
  - `wheelDriveEnabled=true`: enforce planar pose.
  - `wheelDriveEnabled=false`: lock robot base to captured pose.
- `web/src/features/viewer/Viewer3D.tsx:3718`
- `web/src/features/viewer/Viewer3D.tsx:3331`

### 5.6 Convergence gate (no unsafe final snap)
- Ends when all target joints within `completionTolerance` OR runtime budget exceeded.
- If not converged:
  - finalize telemetry/adaptation
  - show warning toast
  - do not force-snap to target
- `web/src/features/viewer/Viewer3D.tsx:3746`

---

## 6) Drag-handle IK path in detail

Component:
- `web/src/features/viewer/IKDragControls.tsx`

### 6.1 Handle rendering
- One `IKDragControls` per detected EE link.
- Label index shown if multiple handles.
- `web/src/features/viewer/Viewer3D.tsx:4533`
- `web/src/features/viewer/IKDragControls.tsx:1088`

### 6.2 Joint scoping to active arm chain
- Strict precedence:
  1. `allowedJointNames` prop (from motion partitions),
  2. chain from URDF analysis runtime cache,
  3. fallback: exclude joints matching wheel/caster/drive/tire regex.
- `web/src/features/viewer/IKDragControls.tsx:166`
- `web/src/features/viewer/IKDragControls.tsx:42`

### 6.3 Target motion model for UI handle
- Spring-damper motion of handle toward desired pointer-projected target.
- Hard cap for visible lead distance from live EE (`MAX_HANDLE_LEAD_DISTANCE_M = 0.08`).
- `web/src/features/viewer/IKDragControls.tsx:947`
- `web/src/features/viewer/IKDragControls.tsx:961`

### 6.4 Latest-only scheduler
- New drag targets overwrite old pending ticket.
- Only one in-flight ticket at a time.
- Result considered stale if newer pending sequence exists.
- `web/src/features/viewer/drag-runtime/scheduler.ts:22`
- `web/src/features/viewer/drag-runtime/scheduler.ts:62`

### 6.5 Solve request behavior
- `runIkSolve`:
  - converts local target to world, then robot-base normalized target.
  - selects orientation mode from `dragOrientation` + solver id.
  - cancels previous in-flight request id.
  - sends `solveIkRequest`.
- `web/src/features/viewer/IKDragControls.tsx:403`
- `web/src/features/viewer/IKDragControls.tsx:449`
- `web/src/features/viewer/IKDragControls.tsx:510`

### 6.6 Native IKD branch (optional)
- If native teleop runtime enabled and ready:
  - sends latest target over IKD channel instead of HTTP solve.
- `web/src/features/viewer/IKDragControls.tsx:458`

### 6.7 Apply streaming solve
- Process result through arm-chain filter.
- Call `onIkSolved` -> `handleIkDragSolved`.
- `web/src/features/viewer/IKDragControls.tsx:600`
- `web/src/features/viewer/useIkSolver.ts:984`

### 6.8 `handleIkDragSolved` smoothing details
- Pulls per-solver tuning values (`smoothAlpha`, step/bounds).
- Computes `dt` from last apply timestamp.
- Blend toward solver output, then enforce:
  - step caps,
  - per-joint velocity limits,
  - limit clamp.
- Applies through motion kernel and store update.
- `web/src/features/viewer/useIkSolver.ts:991`
- `web/src/features/viewer/useIkSolver.ts:1068`
- `web/src/features/viewer/useIkSolver.ts:1114`

---

## 7) Motion kernel: separation by manipulator owner

Core:
- `web/src/features/viewer/motion-kernel/kernel.ts`

What it does:
- Partitions joints by owner (`arm:<ee>`, `base:wheel-drive`, `gripper:aux`).
- Sanitizes manipulator targets so only owned joints are accepted.
- Enforces wheel-drive disabled policy by rejecting base joints.
- Handles command conflicts by priority.

Relevant code:
- Owner resolution:
  - `web/src/features/viewer/motion-kernel/kernel.ts:23`
- Sanitize:
  - `web/src/features/viewer/motion-kernel/kernel.ts:138`
- Apply/reject logic:
  - `web/src/features/viewer/motion-kernel/kernel.ts:50`

Practical effect:
- Arm IK command is kept in arm domain and does not directly write unrelated joints when partition data is available.

---

## 8) Local solver internals (`ik-js`)

File:
- `web/src/features/ik/ikJsSolver.ts`

### 8.1 Caches
- Robot parse cache by URDF string.
- Chain cache by `(urdf.length, targetLink)`.
- `web/src/features/ik/ikJsSolver.ts:13`

### 8.2 Seed candidates
- Runs CCD from multiple seeds:
  - current
  - centered
  - lower-biased
  - upper-biased
- `web/src/features/ik/ikJsSolver.ts:123`

### 8.3 CCD update constraints
- Rotational step cap `MAX_STEP_RAD = 0.35`.
- Prismatic step cap `MAX_STEP_LINEAR = 0.02`.
- Limit-center bias to avoid edge sticking.
- `web/src/features/ik/ikJsSolver.ts:18`
- `web/src/features/ik/ikJsSolver.ts:360`
- `web/src/features/ik/ikJsSolver.ts:399`

### 8.4 Candidate scoring
- Combined objective:
  - position cost
  - center/limit posture penalties
  - continuity penalty vs current state
  - floor penalty
  - self-crowding penalty
- `web/src/features/ik/ikJsSolver.ts:429`

### 8.5 Output diagnostics
- Encodes seed id and penalty summaries in `branch_message`.
- `web/src/features/ik/ikJsSolver.ts:498`

---

## 9) IKFast local adapter path

File:
- `web/src/features/ik/ikfastSolver.ts`

Key behavior:
- Dynamically imports configured WASM module.
- Supports factory export or direct solve export.
- Uses timeout wrapper.
- Normalizes result to common `IkResponsePayload`.

Relevant code:
- availability check:
  - `web/src/features/ik/ikfastSolver.ts:36`
- solve entry:
  - `web/src/features/ik/ikfastSolver.ts:146`

---

## 10) Coordinate normalization and orientation payload

Helpers:
- `web/src/features/viewer/viewer-helpers.ts`

Important:
- All solve targets are normalized into robot-base frame before solver call.
- Orientation payload includes both quaternion (`wxyz`) and rotation matrix.

Relevant code:
- base-frame normalization:
  - `web/src/features/viewer/viewer-helpers.ts:81`
- orientation payload:
  - `web/src/features/viewer/viewer-helpers.ts:146`

---

## 11) Visible UI behavior tied to IK code

### Drag mode defaults
- Studio default drag mode: `drag-handle`.
- Assembly mode forces `move-joints`.
- `web/src/features/viewer/Viewer3D.tsx:3131`

### Multi-EE handles
- If no manually selected EE, deepest leaf links are used.
- One draggable handle rendered per EE.
- `web/src/features/viewer/Viewer3D.tsx:3143`
- `web/src/features/viewer/Viewer3D.tsx:4533`

### Wheel drive toggle
- UI toggle updates whether base/wheel joints can be part of applied commands.
- `web/src/features/viewer/Viewer3D.tsx:4686`

---

## 12) Modules that exist but are not currently wired into live drag/apply path

### `drag-runtime/safetyFast.ts` and `commitValidate.ts`
- These provide fast candidate safety scoring and release validation utilities.
- They are exported, but no active calls from `IKDragControls` in current code.
- `web/src/features/viewer/drag-runtime/index.ts:22`

### Experimental policy-learning and reach-ranking modules
- These dead modules were removed during dead-code hardening because they had no live integration path.
- If adaptive IK policy selection returns, it should be added behind a wired feature boundary instead of kept as dormant code.

---

## 13) Exact end-to-end sequence diagrams

### A) Object click

```text
CreatedObjects.onIkTargetClick
  -> useIkSolver.solveIkForObject
      -> normalize target pose
      -> optional rear transit solve
      -> primary solveIk(...)
      -> optional ik-js fallback by risk gate
      -> setIkResult
  -> Viewer3D useEffect(ikResult)
      -> clamp + sanitize arm targets
      -> applyIkSolutionWithPath
          -> AdaptiveTrajectoryRuntime.step per frame
          -> safety projection
          -> convergence gate
```

### B) Drag handle

```text
pointer drag
  -> IKDragControls.updateDragTarget
  -> scheduler.enqueueLatestDragTarget
  -> frame loop pops latest ticket
  -> runIkSolve
      -> cancel previous requestId
      -> solveIkRequest(...)
      -> stale checks
      -> onIkSolved(solution)
  -> useIkSolver.handleIkDragSolved
      -> blend + velocity bound + clamp
      -> motionKernel apply (arm-domain command)
      -> applyJointValues + store update
```

---

## 14) Debug checklist (very concrete)

If "clicking object does not move robot":
1. Verify `ikResult.solution` exists after click:
   - breakpoint/log in `web/src/features/viewer/useIkSolver.ts:751`
2. Verify target joints not empty after sanitize:
   - `web/src/features/viewer/Viewer3D.tsx:3406`
3. Verify convergence is not failing:
   - `web/src/features/viewer/Viewer3D.tsx:3746`
4. Verify base lock is not masking expected motion:
   - `web/src/features/viewer/Viewer3D.tsx:3718`

If "drag feels delayed or detached":
1. Check scheduler stale drops:
   - `web/src/features/viewer/drag-runtime/scheduler.ts:62`
2. Check request cancellation churn:
   - `web/src/features/viewer/IKDragControls.tsx:510`
3. Check `effectiveIkThrottleMs` and spring params:
   - `web/src/features/viewer/IKDragControls.tsx:145`
4. Check handle lead clamp:
   - `web/src/features/viewer/IKDragControls.tsx:961`

If "wrong joints move during IK":
1. Verify `allowedJointNames` for each EE:
   - `web/src/features/viewer/Viewer3D.tsx:4541`
2. Verify `sanitizeManipulatorTargets` output:
   - `web/src/features/viewer/motion-kernel/kernel.ts:138`
3. Confirm selected EE and owner mapping:
   - `web/src/features/viewer/useIkSolver.ts:278`

---

## 15) Current constraints and practical implications

1. Frontend solver selection is effectively fixed to `ik-js` by store design.
2. Drag pipeline and click pipeline are intentionally separate (different latency/quality tradeoffs).
3. Safety is currently strongest in trajectory-apply projection (`Viewer3D` apply path), not in drag-side preselection utilities.
4. Adaptive policy learning is not part of the live solve path.

---

## 16) If you want this to become "self-optimizing IK OS"

Minimal integration order (code-grounded):
1. Wire `selectBestFastCandidate` into drag `runIkSolve` pre-apply path.
2. Introduce any future adaptive ranking behind a concrete runtime feature boundary.
3. Keep deterministic fallback path for reproducibility and debugging.

This keeps current architecture but adds adaptive policy on top without destabilizing baseline behavior.
