# SoTA Commission Manipulation Plan

## Goal

Use the existing URDF Studio stack to produce a commission-ready submission for minimal-shot manipulation:

- capture a previously unseen tabletop scene
- reconstruct enough scene structure to act in it
- run a manipulation policy with bounded assumptions
- show both successes and understood failures

This repo is not an AV benchmark stack. The closest credible submission path is manipulation with:

- `cam-to-sim` live capture
- `r2r2r`-style export artifacts
- world package and rollout contracts
- LeRobot policy training and evaluation
- Studio replay and dataset review

## Root Cause

The repo already contains most of the required primitives, but they are spread across APIs, scripts, and UI surfaces:

- capture and geometry staging live under `cam-to-sim`
- world execution lives behind world package and rollout contracts
- policy work lives under training and evaluation services
- failure analysis lives in dataset review

What is missing is a single canonical submission path, a reproducible demo protocol, and packaging for the final deliverables.

## Submission Shape

Recommended submission:

- Domain: tabletop manipulation
- Task: object pickup, placement, or simple stack interaction in a newly captured scene
- Minimal-shot claim:
  - no environment-specific retraining for the submission scene
  - only generic priors, generic policy weights, and live scene capture
  - geometry comes from live capture plus primitive or proxy reconstruction

This is a better fit for the current repository than autonomous driving.

## Existing Components

### 1. Scene Capture

Use `cam-to-sim` phone capture sessions to ingest RGB frames and available metadata:

- session creation
- live frame ingest
- capture readiness checks
- capture coach guidance

Expected artifact:

- a session with enough frames, pose coverage, and intrinsics to export

### 2. Real-to-Sim Export

Use the `r2r2r` prepare/export path to materialize:

- RGB frames
- poses
- intrinsics
- optional depth
- optional IMU
- readiness manifest

This is the repo's nearest equivalent to a benchmark tutorial handoff.

### 3. Geometry Reconstruction

Use geometry mesh jobs in one of two modes:

- `proxy_geometry`
  - fastest and most reliable for a commission demo
  - reconstructs scene objects as primitive proxies such as box, sphere, cylinder, mug
- exact mesh
  - only if live capture has depth, calibrated intrinsics, and stable pose data

Recommended default:

- use `proxy_geometry`
- treat exact-mesh as an optional stretch goal

### 4. World Packaging

Package the reconstructed scene into a world package with:

- URDF snapshot
- object list
- camera list
- timing contract
- runtime target metadata

This makes the scene portable and replayable.

### 5. Rollout Harness

Run the packaged scene through the world rollout contract:

- create a rollout campaign
- include a checker profile
- collect trace records
- collect warn/reject/stop/escalate decisions

This is the cleanest path in the repo for producing structured evidence rather than only a video.

### 6. Policy Training or Reuse

Use the existing LeRobot training stack only if the submission needs a tuned policy.

Recommended baseline:

- start from an existing generic manipulation policy or pretrained weights
- avoid scene-specific retraining
- if training is needed, train on broad data and evaluate zero-shot on the captured commission scene

### 7. Evaluation and Replay

Use policy evaluation plus Studio replay to generate:

- rollout video
- action traces
- episode artifacts
- failure cases for review

Use the dataset review UI for failure analysis and curation.

## Minimal Viable Submission

The lowest-risk credible submission using this repo is:

1. Capture one unseen tabletop scene with 2-4 objects using `cam-to-sim`.
2. Export `r2r2r` artifacts.
3. Build proxy geometry for the scene.
4. Package the scene as a world package.
5. Run one simple manipulation policy:
   - pick one object
   - place it in a target zone
   - or perform a simple two-object stack interaction
6. Record:
   - one success case
   - one partial success
   - one understood failure
7. Submit the repo, short write-up, and short video.

This is enough to satisfy the commission spirit without pretending the repo is an AV benchmark.

## Stronger Submission

If there is time, upgrade the minimal submission with:

- multi-object scenes instead of single-object scenes
- stacked-object capture mode
- rollout checker modules for contact/safety/latency conditions
- randomized object layouts across several captured scenes
- evaluation split:
  - capture scene A for development
  - capture scenes B/C for final evaluation

That turns the demo from a one-off into a small generalization study.

## Required New Work

The following gaps still need implementation or hardening for a clean submission:

### A. Canonical Runner

Add one script or documented command sequence that performs:

- capture export
- geometry job generation
- world package creation
- rollout launch
- policy eval

Without this, the stack remains too fragmented for a submission workflow.

### B. Checker Profile

Define a checker profile for manipulation rollouts, for example:

- workspace bounds
- forbidden zones
- contact or collision warnings
- timeout / latency budget
- task completion signal

This gives the rollout traces interpretable outcomes.

### C. Submission Metrics

Standardize 3-5 metrics and keep them fixed:

- task success
- time to completion
- number of warns/rejects/stops
- number of human resets
- scene transfer count

Avoid benchmark sprawl.

### D. Reproducible Demo Assets

Create a single export directory for the final submission containing:

- world package manifest
- rollout campaign manifest
- checker profile
- trace NDJSON
- decision NDJSON
- demo video
- short report

## Quality Scope

If code changes are made to support the submission, keep the scope narrow:

- centralize any new tunables in local params modules
- avoid parallel demo-only code paths
- prefer reusable orchestration over ad hoc scripts
- add tests for new orchestration and contract code

Do not build a fake benchmark surface that the repo cannot actually support.

## Validation Strategy

Before claiming the submission is ready, verify:

- `cam-to-sim` capture export produces complete manifests
- geometry jobs produce a usable proxy URDF
- world package validates
- rollout jobs run end-to-end
- policy evaluation returns replayable episodes
- at least one failure case is captured and explained

Repo checks to run for touched code:

- `npm run smoke`
- relevant backend tests
- relevant frontend tests
- any rollout or world validation command added during implementation

## Deliverables Mapping

### GitHub Repo

Use this repository plus a top-level submission README section describing:

- task
- capture flow
- policy source
- world packaging
- evaluation protocol
- failure cases

### Analysis Notebook

This repo does not currently center around notebooks. The practical substitute is:

- a short analysis document
- exported traces
- screenshots from dataset review

If a notebook is required, generate a lightweight analysis notebook from the final rollout artifacts rather than moving the core workflow into Jupyter.

### 1-5 Minute Video

Show:

1. live scene capture
2. proxy or reconstructed scene
3. policy rollout
4. success
5. failure with explanation

### Short Write-Up

Keep the write-up to:

- motivation
- minimal-shot hypothesis
- scene-to-world pipeline
- policy assumptions
- results and failure modes
- next step if funded

## Recommended Claim

The strongest honest claim this repo can support is:

> A manipulation system that captures a previously unseen tabletop scene, constructs a usable world representation with minimal scene-specific assumptions, and executes a generic manipulation policy with structured rollout evidence and failure analysis.

That is materially closer to the commission brief than trying to stretch this codebase into an autonomous driving submission.
